import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { VERCEL_PROJECTS } from './lib/vercel-api.ts'
import { CURRENT_PHASE, parseEnvSpec, planSync, reached, run } from './vercel-env-sync.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const STAGING = VERCEL_PROJECTS.staging
const SECRET_VALUE = 'valor-sensivel-que-nunca-aparece'

function realSpec(env: 'staging' | 'production'): unknown {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'infra', 'vercel', `env.${env}.json`), 'utf8'))
}

const SMALL_SPEC = {
  project: 'tekoia-staging',
  config: {
    APP_ENV: { value: 'staging', since: 'F1' },
    LOG_LEVEL: { value: 'info', since: 'F1' },
    NEW_ONE: { value: 'x', since: 'F7' },
    FUTURE: { value: 'y', since: 'F9' },
  },
  sensitive: {
    DATABASE_URL: { requiredFrom: 'F2' },
    LATER_KEY: { requiredFrom: 'F9' },
  },
}

interface StoredEnv {
  id: string
  key: string
  type: string
  target: string[]
  value: string
}

/** API da Vercel de mentira, com o estado das env vars e o registro das escritas. */
function fakeVercel(envs: StoredEnv[], projectName = STAGING.name) {
  const writes: { method: string; path: string; body: unknown }[] = []
  const doFetch = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const path = url.pathname
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    if (method === 'GET' && path === `/v9/projects/${STAGING.id}`) {
      return json({ id: STAGING.id, name: projectName })
    }
    if (method === 'GET' && path === `/v10/projects/${STAGING.id}/env`) {
      // A listagem não traz valor de Sensitive.
      return json({ envs: envs.map(({ value: _value, ...rest }) => rest) })
    }
    const one = /^\/v1\/projects\/[^/]+\/env\/([^/]+)$/.exec(path)
    if (method === 'GET' && one) {
      const found = envs.find((env) => env.id === one[1])
      if (found === undefined) {
        return json({ error: { code: 'not_found' } }, 404)
      }
      return json(found.type === 'sensitive' ? { ...found, value: '' } : found)
    }
    const body: unknown = init?.body === undefined ? undefined : JSON.parse(String(init.body))
    writes.push({ method, path, body })
    return json({})
  }) as typeof fetch
  return { doFetch, writes }
}

const ENV = { VERCEL_TOKEN: 'tok', VERCEL_ORG_ID: 'team_abc', VERCEL_PROJECT_ID: STAGING.id }

async function sync(
  envs: StoredEnv[],
  options: { spec?: unknown; dryRun?: boolean; projectName?: string } = {},
) {
  const fake = fakeVercel(envs, options.projectName)
  const lines: string[] = []
  const result = await run(
    {
      env: ENV,
      fetch: fake.doFetch,
      log: (line) => lines.push(line),
      readSpec: () => options.spec ?? SMALL_SPEC,
    },
    { env: 'staging', dryRun: options.dryRun ?? false },
  )
  return { ...result, writes: fake.writes, lines, output: [...lines, ...result.summary].join('\n') }
}

const sensitive = (key: string, id = key): StoredEnv => ({
  id,
  key,
  type: 'sensitive',
  target: ['production'],
  value: SECRET_VALUE,
})
const config = (key: string, value: string, id = key): StoredEnv => ({
  id,
  key,
  type: 'encrypted',
  target: ['production'],
  value,
})

describe('parseEnvSpec', () => {
  for (const env of ['staging', 'production'] as const) {
    it(`env.${env}.json é válido e não cita LLM_KILL_SWITCH, GIT_SHA nem APP_VERSION`, () => {
      const spec = parseEnvSpec(realSpec(env), env)
      assert.equal(spec.project, VERCEL_PROJECTS[env].name)
      assert.ok(spec.config.size > 0 && spec.sensitive.size > 0)
    })
  }

  it('recusa LLM_KILL_SWITCH, GIT_SHA e APP_VERSION no JSON', () => {
    for (const name of ['LLM_KILL_SWITCH', 'GIT_SHA', 'APP_VERSION']) {
      assert.throws(
        () => parseEnvSpec({ ...SMALL_SPEC, config: { [name]: { value: '1', since: 'F7' } } }, 'x'),
        new RegExp(name),
      )
    }
  })

  it('recusa nome repetido entre config e sensitive, nome inválido e fase fora do formato', () => {
    assert.throws(() =>
      parseEnvSpec(
        {
          project: 'p',
          config: { A: { value: '1', since: 'F1' } },
          sensitive: { A: { requiredFrom: 'F1' } },
        },
        'x',
      ),
    )
    assert.throws(() =>
      parseEnvSpec(
        { project: 'p', config: { 'a-b': { value: '1', since: 'F1' } }, sensitive: {} },
        'x',
      ),
    )
    assert.throws(() =>
      parseEnvSpec(
        { project: 'p', config: { A: { value: '1', since: 'fase 1' } }, sensitive: {} },
        'x',
      ),
    )
  })
})

describe('reached', () => {
  it('compara a fase numericamente', () => {
    assert.equal(reached('F2', 'F7'), true)
    assert.equal(reached('F7', 'F7'), true)
    assert.equal(reached('F10', 'F7'), false)
    assert.equal(CURRENT_PHASE, 'F7')
  })
})

describe('planSync', () => {
  it('Config que no projeto é Sensitive vira erro; env var de outro alvo não conta', () => {
    const spec = parseEnvSpec(SMALL_SPEC, 'x')
    const plan = planSync(spec, [
      { id: '1', key: 'APP_ENV', type: 'sensitive', target: ['production'] },
      { id: '2', key: 'DATABASE_URL', type: 'sensitive', target: ['preview'] },
    ])
    assert.deepEqual(plan.configAsSensitive, ['APP_ENV'])
    assert.deepEqual(plan.missingSensitive, ['DATABASE_URL'])
  })
})

describe('run', () => {
  it('cria a Config que falta, atualiza a diferente e mantém a igual; ignora o que é de fase futura', async () => {
    const result = await sync([
      config('APP_ENV', 'staging'),
      config('LOG_LEVEL', 'debug'),
      sensitive('DATABASE_URL'),
    ])
    assert.equal(result.code, 0, result.output)
    assert.deepEqual(result.writes, [
      {
        method: 'PATCH',
        path: `/v9/projects/${STAGING.id}/env/LOG_LEVEL`,
        body: { value: 'info', type: 'encrypted' },
      },
      {
        method: 'POST',
        path: `/v10/projects/${STAGING.id}/env`,
        body: { key: 'NEW_ONE', value: 'x', type: 'encrypted', target: ['production'] },
      },
    ])
    assert.doesNotMatch(result.output, /FUTURE/)
  })

  it('falha antes de escrever quando falta Sensitive obrigatória, só com os nomes', async () => {
    const result = await sync([config('APP_ENV', 'outro')])
    assert.equal(result.code, 1)
    assert.deepEqual(result.writes, [])
    assert.match(result.output, /faltam as Sensitive DATABASE_URL/)
    assert.doesNotMatch(result.output, /LATER_KEY/)
  })

  it('nunca toca LLM_KILL_SWITCH e cita as env vars de fora do JSON só pelo nome', async () => {
    const result = await sync([
      config('APP_ENV', 'staging'),
      config('LOG_LEVEL', 'info'),
      config('NEW_ONE', 'x'),
      sensitive('DATABASE_URL'),
      { ...config('LLM_KILL_SWITCH', 'true'), type: 'encrypted' },
    ])
    assert.equal(result.code, 0, result.output)
    assert.deepEqual(result.writes, [])
    assert.match(result.output, /`LLM_KILL_SWITCH`/)
    assert.doesNotMatch(result.output, /LLM_KILL_SWITCH.*true/)
  })

  it('nunca imprime valor de Sensitive nem de Config', async () => {
    const result = await sync([config('APP_ENV', 'outro-valor'), sensitive('DATABASE_URL')])
    assert.equal(result.code, 0)
    assert.doesNotMatch(result.output, new RegExp(SECRET_VALUE))
    assert.doesNotMatch(result.output, /outro-valor/)
  })

  it('recusa GIT_SHA ou APP_VERSION no projeto (vêm do artefato)', async () => {
    const result = await sync([sensitive('DATABASE_URL'), config('GIT_SHA', 'abc')])
    assert.equal(result.code, 1)
    assert.match(result.output, /GIT_SHA não podem existir no projeto/)
    assert.deepEqual(result.writes, [])
  })

  it('avisa quando uma Sensitive do JSON existe com tipo não sensível', async () => {
    const result = await sync([{ ...sensitive('DATABASE_URL'), type: 'encrypted' }])
    assert.equal(result.code, 0)
    assert.match(result.output, /::warning title=vercel-env-sync::DATABASE_URL existe/)
  })

  it('dry-run: mostra o plano e não escreve', async () => {
    const result = await sync([sensitive('DATABASE_URL')], { dryRun: true })
    assert.equal(result.code, 0)
    assert.deepEqual(result.writes, [])
    assert.match(result.output, /a criar: APP_ENV/)
  })

  it('para se o id do projeto não for o tekoia-staging', async () => {
    const result = await sync([sensitive('DATABASE_URL')], { projectName: 'tekoia' })
    assert.equal(result.code, 1)
    assert.deepEqual(result.writes, [])
  })

  it('o JSON real do staging, com todas as Sensitive presentes, cria toda a Config', async () => {
    const spec = parseEnvSpec(realSpec('staging'), 'staging')
    const result = await sync(
      [...spec.sensitive.keys()].map((key) => sensitive(key)),
      { spec: realSpec('staging') },
    )
    assert.equal(result.code, 0, result.output)
    assert.equal(result.writes.length, spec.config.size)
    assert.ok(result.writes.every((write) => write.method === 'POST'))
  })
})
