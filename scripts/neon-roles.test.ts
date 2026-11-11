import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { describePlan, planRoles, SECRET_TARGETS } from './neon-roles.ts'

const none = new Map<string, Set<string>>()

describe('planRoles', () => {
  it('cria os dois roles e grava todos os segredos num projeto novo', () => {
    const plan = planRoles('production', new Set(['neondb_owner']), none, false)
    assert.deepEqual(
      plan.map(({ role, action, secrets }) => [role, action, secrets.map((s) => s.secret)]),
      [
        ['teko_app', 'create', ['NEON_PROD_APP_URL']],
        ['teko_watch', 'create', ['NEON_PROD_WATCH_URL']],
      ],
    )
  })

  it('mantém o role existente e só grava os segredos que faltam', () => {
    const secrets = new Map([
      ['staging', new Set(['NEON_STAGING_APP_URL'])],
      ['maintenance', new Set<string>()],
    ])
    const plan = planRoles('staging', new Set(['teko_app']), secrets, false)
    assert.equal(plan[0]?.action, 'keep')
    assert.deepEqual(plan[0]?.secrets, [
      { environment: 'maintenance', secret: 'NEON_STAGING_APP_URL' },
    ])
    assert.equal(plan[1]?.action, 'create')
  })

  it('com --reset-password troca a senha e regrava todos os destinos', () => {
    const secrets = new Map([
      ['staging', new Set(['NEON_STAGING_APP_URL'])],
      ['maintenance', new Set(['NEON_STAGING_APP_URL'])],
      ['corpus-watch', new Set(['NEON_STAGING_WATCH_URL'])],
    ])
    const plan = planRoles('staging', new Set(['teko_app', 'teko_watch']), secrets, true)
    assert.deepEqual(
      plan.map(({ action, secrets: s }) => [action, s.length]),
      [
        ['reset', SECRET_TARGETS.staging.teko_app.length],
        ['reset', SECRET_TARGETS.staging.teko_watch.length],
      ],
    )
  })

  it('não faz nada quando roles e segredos já existem', () => {
    const secrets = new Map([
      ['maintenance', new Set(['NEON_PROD_APP_URL'])],
      ['corpus-watch', new Set(['NEON_PROD_WATCH_URL'])],
    ])
    const plan = planRoles('production', new Set(['teko_app', 'teko_watch']), secrets, false)
    assert.deepEqual(describePlan(plan), [
      'teko_app: keep; segredos a gravar: nenhum',
      'teko_watch: keep; segredos a gravar: nenhum',
    ])
  })

  it('o teko_watch nunca vai para um environment com credencial de escrita no corpus', () => {
    for (const target of ['staging', 'production'] as const) {
      for (const { environment } of SECRET_TARGETS[target].teko_watch) {
        assert.equal(environment, 'corpus-watch')
      }
    }
  })
})
