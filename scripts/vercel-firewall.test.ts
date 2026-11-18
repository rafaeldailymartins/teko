import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { VERCEL_PROJECTS } from './lib/vercel-api.ts'
import {
  canonicalRule,
  isLockdown,
  LOCKDOWN_LOCATION,
  LOCKDOWN_RULE,
  type ProjectRules,
  parseActiveConfig,
  parseProjectRules,
  planFirewall,
  run,
} from './vercel-firewall.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const RULES_FILE = join(REPO_ROOT, 'infra', 'vercel', 'firewall-rules.json')
const rawRules = (): unknown => JSON.parse(readFileSync(RULES_FILE, 'utf8'))
const STAGING = VERCEL_PROJECTS.staging

function wanted(): ProjectRules {
  return parseProjectRules(rawRules(), STAGING.name)
}

/** Como a Vercel devolve uma regra: com id, `neg: false` explícito e campos de validação. */
function stored(rule: Readonly<Record<string, unknown>>, id: string) {
  const copy = JSON.parse(JSON.stringify(rule)) as Record<string, unknown>
  for (const group of copy['conditionGroup'] as { conditions: Record<string, unknown>[] }[]) {
    for (const condition of group.conditions) {
      condition['neg'] ??= false
    }
  }
  return { ...copy, id, valid: true, validationErrors: null } as unknown as Record<
    string,
    unknown
  > & {
    name: string
    id: string
  }
}

function inSync(rules: ProjectRules) {
  return rules.rules.map((rule, index) => stored(rule, `rule_${String(index)}`))
}

describe('firewall-rules.json', () => {
  for (const project of Object.values(VERCEL_PROJECTS)) {
    it(`${project.name}: 3 regras, lockdown da regra 1, nenhum challenge`, () => {
      const rules = parseProjectRules(rawRules(), project.name)
      assert.deepEqual(
        rules.rules.map((rule) => rule.name),
        ['deny-unknown-api', 'deny-unsafe-static', 'rate-limit-stream'],
      )
      assert.equal(rules.lockdown.name, LOCKDOWN_RULE)
    })
  }

  for (const project of Object.values(VERCEL_PROJECTS)) {
    it(`${project.name}: o lockdown redireciona (307) para /aviso/ tudo exceto /healthz, /api/healthz, o aviso e o estático dele`, () => {
      const lockdown = parseProjectRules(rawRules(), project.name).lockdown
      assert.deepEqual(lockdown['action'], {
        mitigate: {
          action: 'redirect',
          rateLimit: null,
          redirect: { location: LOCKDOWN_LOCATION, permanent: false },
          actionDuration: null,
        },
      })
      const conditions = (
        lockdown['conditionGroup'] as { conditions: { value: string; neg: boolean }[] }[]
      ).flatMap((group) => group.conditions)
      const condition = conditions[0]
      assert.equal(conditions.length, 1)
      assert.ok(condition?.neg)
      const allowed = new RegExp(condition.value)
      // O destino do redirect fica de fora da regra: sem isso, o redirect entraria em laço.
      assert.ok(allowed.test(LOCKDOWN_LOCATION))
      for (const path of [
        '/healthz',
        '/api/healthz',
        '/aviso',
        '/aviso/',
        '/aviso/index.txt',
        '/_next/static/chunks/a.js',
        '/_next/static/media/geist.woff2',
        '/favicon.ico',
      ]) {
        assert.ok(allowed.test(path), path)
      }
      for (const path of [
        '/',
        '/pt-BR/',
        '/pt-BR/aviso/',
        '/en/aviso/',
        '/api/v1/coverage',
        '/api/v1/questions',
        '/api/auth/session',
        '/healthz/x',
        '/avisos',
        '/icon.svg',
      ]) {
        assert.ok(!allowed.test(path), path)
      }
    })
  }

  it('recusa lockdown que nega em vez de redirecionar, ou com redirect permanente', () => {
    const raw = rawRules() as {
      projects: Record<string, { lockdown: { action: { mitigate: Record<string, unknown> } } }>
    }
    const deny = structuredClone(raw)
    const denyTarget = deny.projects[STAGING.name]
    assert.ok(denyTarget)
    denyTarget.lockdown.action.mitigate = { action: 'deny', redirect: null }
    assert.throws(() => parseProjectRules(deny, STAGING.name), /redirecionar para \/aviso\//)
    const permanent = structuredClone(raw)
    const permanentTarget = permanent.projects[STAGING.name]
    assert.ok(permanentTarget)
    permanentTarget.lockdown.action.mitigate = {
      action: 'redirect',
      redirect: { location: LOCKDOWN_LOCATION, permanent: true },
    }
    assert.throws(() => parseProjectRules(permanent, STAGING.name), /permanent: false/)
  })

  it('recusa regra com challenge e lockdown de outra regra', () => {
    const raw = rawRules() as {
      projects: Record<
        string,
        { rules: Record<string, unknown>[]; lockdown: Record<string, unknown> }
      >
    }
    const withChallenge = structuredClone(raw)
    const target = withChallenge.projects[STAGING.name]
    assert.ok(target)
    target.rules[1] = { ...target.rules[1], action: { mitigate: { action: 'challenge' } } }
    assert.throws(() => parseProjectRules(withChallenge, STAGING.name), /challenge/)
    const otherRule = structuredClone(raw)
    const other = otherRule.projects[STAGING.name]
    assert.ok(other)
    other.lockdown = { ...other.lockdown, name: 'deny-unsafe-static' }
    assert.throws(() => parseProjectRules(otherRule, STAGING.name), /lockdown/)
  })
})

describe('canonicalRule', () => {
  it('ignora id, nulos e neg: false', () => {
    const rule = wanted().rules[0]
    assert.ok(rule)
    assert.equal(canonicalRule(stored(rule, 'x')), canonicalRule(rule))
  })
})

describe('planFirewall', () => {
  it('projeto em dia: nada a escrever', () => {
    const plan = planFirewall(
      { firewallEnabled: true, rules: inSync(wanted()) },
      wanted(),
      undefined,
    )
    assert.deepEqual(plan.actions, [])
    assert.equal(plan.lockdown, 'off')
  })

  it('regra que falta vira insert; regra diferente vira update com o id da existente', () => {
    const rules = wanted()
    const current = inSync(rules).slice(0, 2)
    const changed = current[1]
    assert.ok(changed)
    changed['description'] = 'mudada à mão'
    const plan = planFirewall({ firewallEnabled: true, rules: current }, rules, undefined)
    assert.deepEqual(
      plan.actions.map((action) => [action.action, action.id, action.value.name]),
      [
        ['rules.update', 'rule_1', 'deny-unsafe-static'],
        ['rules.insert', null, 'rate-limit-stream'],
      ],
    )
  })

  it('--lockdown on troca a regra 1 pelo payload de lockdown', () => {
    const rules = wanted()
    const plan = planFirewall({ firewallEnabled: true, rules: inSync(rules) }, rules, 'on')
    assert.equal(plan.actions.length, 1)
    assert.equal(plan.actions[0]?.action, 'rules.update')
    assert.equal(plan.actions[0]?.id, 'rule_0')
    assert.equal(plan.actions[0]?.value, rules.lockdown)
    assert.equal(plan.lockdown, 'on')
  })

  it('o sync do deploy mantém um lockdown ativo e sincroniza o resto', () => {
    const rules = wanted()
    const current = inSync(rules)
    current[0] = stored(rules.lockdown, 'rule_0')
    const third = current[2]
    assert.ok(third)
    third['active'] = false
    const plan = planFirewall({ firewallEnabled: true, rules: current }, rules, undefined)
    assert.equal(plan.keptLockdown, true)
    assert.equal(plan.lockdown, 'on')
    assert.deepEqual(
      plan.actions.map((action) => action.value.name),
      ['rate-limit-stream'],
    )
  })

  it('--lockdown on sobre um lockdown antigo (deny) grava o redirect: a comparação enxerga o campo redirect', () => {
    const rules = wanted()
    const current = inSync(rules)
    const old = stored(rules.lockdown, 'rule_0')
    old['action'] = {
      mitigate: { action: 'deny', rateLimit: null, redirect: null, actionDuration: null },
    }
    current[0] = old
    const plan = planFirewall({ firewallEnabled: true, rules: current }, rules, 'on')
    assert.deepEqual(
      plan.actions.map((action) => [action.action, action.id]),
      [['rules.update', 'rule_0']],
    )
    assert.equal(plan.actions[0]?.value, rules.lockdown)
    const otherTarget = stored(rules.lockdown, 'rule_0')
    otherTarget['action'] = {
      mitigate: {
        action: 'redirect',
        redirect: { location: '/outro/', permanent: false },
      },
    }
    current[0] = otherTarget
    assert.equal(
      planFirewall({ firewallEnabled: true, rules: current }, rules, 'on').actions.length,
      1,
    )
    current[0] = stored(rules.lockdown, 'rule_0')
    assert.deepEqual(
      planFirewall({ firewallEnabled: true, rules: current }, rules, 'on').actions,
      [],
    )
  })

  it('reconhece um lockdown gravado à mão pela descrição', () => {
    const rules = wanted()
    const manual = {
      ...stored(rules.rules[0] ?? rules.lockdown, 'r'),
      description: 'LOCKDOWN manual',
    }
    assert.equal(isLockdown(manual, rules.lockdown), true)
  })

  it('--lockdown off volta a regra 1 ao normal', () => {
    const rules = wanted()
    const current = inSync(rules)
    current[0] = stored(rules.lockdown, 'rule_0')
    const plan = planFirewall({ firewallEnabled: true, rules: current }, rules, 'off')
    assert.equal(plan.actions.length, 1)
    assert.equal(plan.actions[0]?.value, rules.rules[0])
    assert.equal(plan.lockdown, 'off')
  })

  it('aponta regras repetidas e regras fora do JSON', () => {
    const rules = wanted()
    const current = [
      ...inSync(rules),
      stored(rules.lockdown, 'dup'),
      stored({ ...rules.lockdown, name: 'manual' }, 'm'),
    ]
    const plan = planFirewall({ firewallEnabled: true, rules: current }, rules, undefined)
    assert.deepEqual(plan.duplicated, [LOCKDOWN_RULE])
    assert.deepEqual(plan.unmanaged, ['manual'])
  })
})

describe('parseActiveConfig', () => {
  it('aceita a config direto ou dentro de active', () => {
    const rule = { name: 'a', id: '1' }
    assert.deepEqual(parseActiveConfig({ firewallEnabled: true, rules: [rule] }).rules, [rule])
    assert.deepEqual(parseActiveConfig({ active: { firewallEnabled: false, rules: [] } }), {
      firewallEnabled: false,
      rules: [],
    })
  })
})

/** API de firewall de mentira: a config ativa e o registro dos PATCH. */
function fakeFirewall(active: unknown, status = 200) {
  const patches: unknown[] = []
  const doFetch = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    if (url.pathname === `/v9/projects/${STAGING.id}`) {
      return new Response(JSON.stringify({ name: STAGING.name }))
    }
    if (method === 'GET' && url.pathname === '/v1/security/firewall/config/active') {
      assert.equal(url.searchParams.get('projectId'), STAGING.id)
      return new Response(JSON.stringify(active), { status })
    }
    if (method === 'PATCH' && url.pathname === '/v1/security/firewall/config') {
      patches.push(JSON.parse(String(init?.body)))
      return new Response('{}')
    }
    return new Response('{}', { status: 500 })
  }) as typeof fetch
  return { doFetch, patches }
}

const ENV = { VERCEL_TOKEN: 'tok', VERCEL_ORG_ID: 'team_abc' }

describe('run', () => {
  it('aplica o que falta por PATCH e devolve o estado do lockdown', async () => {
    const fake = fakeFirewall({ firewallEnabled: true, rules: [] })
    const lines: string[] = []
    const result = await run(
      { env: ENV, fetch: fake.doFetch, log: (line) => lines.push(line), readRules: rawRules },
      { env: 'staging', lockdown: undefined, dryRun: false },
    )
    assert.equal(result.code, 0, result.summary.join('\n'))
    assert.equal(fake.patches.length, 3)
    assert.deepEqual(
      fake.patches.map((patch) => Reflect.get(Object(patch), 'action')),
      ['rules.insert', 'rules.insert', 'rules.insert'],
    )
    assert.equal(result.lockdown, 'off')
    assert.equal(result.changes, 3)
  })

  it('projeto sem config de firewall (404): tudo vira insert', async () => {
    const fake = fakeFirewall({ error: { code: 'not_found' } }, 404)
    const result = await run(
      { env: ENV, fetch: fake.doFetch, log: () => undefined, readRules: rawRules },
      { env: 'staging', lockdown: 'on', dryRun: false },
    )
    assert.equal(result.code, 0)
    assert.equal(fake.patches.length, 3)
    assert.equal(result.lockdown, 'on')
  })

  it('dry-run lê e não escreve', async () => {
    const rules = wanted()
    const fake = fakeFirewall({ firewallEnabled: true, rules: [stored(rules.lockdown, 'r0')] })
    const result = await run(
      { env: ENV, fetch: fake.doFetch, log: () => undefined, readRules: rawRules },
      { env: 'staging', lockdown: 'off', dryRun: true },
    )
    assert.equal(result.code, 0)
    assert.deepEqual(fake.patches, [])
    assert.equal(result.lockdown, 'on')
  })

  it('lockdown sem o redirect temporário no JSON: falha antes de chamar a API', async () => {
    const raw = rawRules() as {
      projects: Record<string, { lockdown: { action: { mitigate: Record<string, unknown> } } }>
    }
    const target = raw.projects[STAGING.name]
    assert.ok(target)
    target.lockdown.action.mitigate = { action: 'deny', redirect: null }
    let calls = 0
    const doFetch = (async () => {
      calls += 1
      return new Response('{}')
    }) as typeof fetch
    const result = await run(
      { env: ENV, fetch: doFetch, log: () => undefined, readRules: () => raw },
      { env: 'staging', lockdown: 'on', dryRun: false },
    )
    assert.equal(result.code, 1)
    assert.equal(calls, 0)
  })

  it('firewall desligado no projeto: falha sem escrever', async () => {
    const fake = fakeFirewall({ firewallEnabled: false, rules: [] })
    const result = await run(
      { env: ENV, fetch: fake.doFetch, log: () => undefined, readRules: rawRules },
      { env: 'staging', lockdown: undefined, dryRun: false },
    )
    assert.equal(result.code, 1)
    assert.deepEqual(fake.patches, [])
  })
})

describe('node scripts/vercel-firewall.ts', () => {
  for (const args of [
    [],
    ['--env', 'prod'],
    ['--env', 'staging', '--lockdown', 'talvez'],
    ['--env', 'staging', 'x'],
  ]) {
    it(`uso errado (${args.join(' ') || 'sem argumentos'}): código 2, sem rede`, () => {
      const result = spawnSync(
        process.execPath,
        [join(REPO_ROOT, 'scripts', 'vercel-firewall.ts'), ...args],
        {
          encoding: 'utf8',
        },
      )
      assert.equal(result.status, 2, result.stderr)
      assert.match(
        result.stderr,
        /uso: node scripts\/vercel-firewall\.ts --env production\|staging/,
      )
    })
  }
})
