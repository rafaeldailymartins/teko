import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import {
  assertProject,
  createVercelApi,
  credentialsFromEnv,
  parseDeployEnv,
  VERCEL_PROJECTS,
  VercelApiError,
  VercelConfigError,
} from './vercel-api.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..')
const TOKEN = 'tok_de_teste'

describe('VERCEL_PROJECTS', () => {
  for (const env of ['production', 'staging'] as const) {
    it(`o projeto de ${env} é o mesmo de infra/vercel/env.${env}.json e do README`, () => {
      const project = VERCEL_PROJECTS[env]
      const spec = JSON.parse(
        readFileSync(join(REPO_ROOT, 'infra', 'vercel', `env.${env}.json`), 'utf8'),
      ) as { project: string; config: { WEB_ORIGIN: { value: string } } }
      assert.equal(spec.project, project.name)
      assert.equal(spec.config.WEB_ORIGIN.value, project.origin)
      const readme = readFileSync(join(REPO_ROOT, 'infra', 'vercel', 'README.md'), 'utf8')
      assert.ok(readme.includes(`\`${project.name}\` (\`${project.id}\`)`), project.id)
    })
  }
})

describe('parseDeployEnv', () => {
  it('aceita só production e staging', () => {
    assert.equal(parseDeployEnv('staging'), 'staging')
    assert.equal(parseDeployEnv('production'), 'production')
    assert.equal(parseDeployEnv('prod'), undefined)
    assert.equal(parseDeployEnv(undefined), undefined)
  })
})

describe('credentialsFromEnv', () => {
  it('lista o que falta, sem valores', () => {
    assert.throws(() => credentialsFromEnv({}, 'staging'), /VERCEL_TOKEN e VERCEL_ORG_ID/)
    assert.throws(
      () => credentialsFromEnv({ VERCEL_TOKEN: TOKEN }, 'staging'),
      /faltam VERCEL_ORG_ID/,
    )
  })

  it('recusa o VERCEL_PROJECT_ID de outro ambiente', () => {
    assert.throws(
      () =>
        credentialsFromEnv(
          {
            VERCEL_TOKEN: TOKEN,
            VERCEL_ORG_ID: 'team_abc',
            VERCEL_PROJECT_ID: VERCEL_PROJECTS.production.id,
          },
          'staging',
        ),
      VercelConfigError,
    )
  })

  it('aceita o VERCEL_PROJECT_ID do próprio ambiente ou nenhum', () => {
    const base = { VERCEL_TOKEN: TOKEN, VERCEL_ORG_ID: 'team_abc' }
    assert.equal(credentialsFromEnv(base, 'staging').project, VERCEL_PROJECTS.staging)
    assert.equal(
      credentialsFromEnv(
        { ...base, VERCEL_PROJECT_ID: VERCEL_PROJECTS.production.id },
        'production',
      ).teamId,
      'team_abc',
    )
  })
})

describe('createVercelApi', () => {
  it('manda o bearer e o teamId e devolve o JSON', async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = []
    const api = createVercelApi({ token: TOKEN, teamId: 'team_abc' }, (async (url, init) => {
      seen.push({ url: String(url), init })
      return new Response('{"ok":true}', { status: 200 })
    }) as typeof fetch)
    assert.deepEqual(await api('GET', '/v9/projects/x', { query: { a: 'b' } }), { ok: true })
    assert.equal(seen[0]?.url, 'https://api.vercel.com/v9/projects/x?a=b&teamId=team_abc')
    assert.equal(new Headers(seen[0]?.init?.headers).get('authorization'), `Bearer ${TOKEN}`)
  })

  it('erro só com método, caminho, status e código da Vercel (nunca o corpo)', async () => {
    const api = createVercelApi(
      { token: TOKEN, teamId: 'team_abc' },
      (async () =>
        new Response('{"error":{"code":"forbidden","message":"valor-secreto"}}', {
          status: 403,
        })) as unknown as typeof fetch,
    )
    await assert.rejects(api('GET', '/v9/projects/x'), (error: unknown) => {
      assert.ok(error instanceof VercelApiError)
      assert.equal(error.status, 403)
      assert.equal(error.message, 'GET /v9/projects/x respondeu 403 (forbidden)')
      return true
    })
  })

  it('recusa caminho relativo ou com subida', async () => {
    const api = createVercelApi(
      { token: TOKEN, teamId: 't' },
      (async () => new Response('{}')) as unknown as typeof fetch,
    )
    await assert.rejects(api('GET', 'v9/projects'), VercelConfigError)
    await assert.rejects(api('GET', '/v9/../x'), VercelConfigError)
  })
})

describe('assertProject', () => {
  it('confere o nome do projeto pelo id', async () => {
    const reply = (name: string) =>
      createVercelApi(
        { token: TOKEN, teamId: 't' },
        (async () => new Response(JSON.stringify({ name }))) as unknown as typeof fetch,
      )
    await assertProject(reply('tekoia-staging'), VERCEL_PROJECTS.staging)
    await assert.rejects(assertProject(reply('tekoia'), VERCEL_PROJECTS.staging), VercelConfigError)
  })
})
