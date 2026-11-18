import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createRoleSql,
  describePlan,
  generatePassword,
  PASSWORD_LENGTH,
  planRoles,
  quoteIdent,
  quoteLiteral,
  type RoleName,
  type RoleState,
  resetPasswordSql,
  revokeSql,
  SECRET_TARGETS,
  withCredentials,
} from './neon-roles.ts'

const none = new Map<string, Set<string>>()
const SQL_ROLE: RoleState = { neonSuperuser: false, ownerAdmin: true }
const API_ROLE: RoleState = { neonSuperuser: true, ownerAdmin: false }

const states = (entries: [RoleName, RoleState][]) => new Map(entries)
const ALL_PROD_SECRETS = new Map([
  ['maintenance', new Set(['NEON_PROD_APP_URL'])],
  ['corpus-watch', new Set(['NEON_PROD_WATCH_URL'])],
])

describe('planRoles', () => {
  it('cria os dois roles e grava todos os segredos num projeto novo', () => {
    const plan = planRoles('production', states([]), none, false)
    assert.deepEqual(
      plan.map(({ role, action, secrets, vercel }) => [
        role,
        action,
        secrets.map((s) => s.secret),
        vercel,
      ]),
      [
        ['teko_app', 'create', ['NEON_PROD_APP_URL'], true],
        ['teko_watch', 'create', ['NEON_PROD_WATCH_URL'], false],
      ],
    )
  })

  it('recria o role da API (membro do neon_superuser), mesmo com os segredos gravados', () => {
    const plan = planRoles(
      'production',
      states([
        ['teko_app', API_ROLE],
        ['teko_watch', API_ROLE],
      ]),
      ALL_PROD_SECRETS,
      false,
    )
    assert.deepEqual(
      plan.map(({ action, secrets, vercel }) => [action, secrets.length, vercel]),
      [
        ['recreate', 1, true],
        ['recreate', 1, false],
      ],
    )
    assert.match(plan[0]?.reason ?? '', /neon_superuser/)
  })

  it('recria o role sem ADMIN do owner, mesmo fora do neon_superuser', () => {
    const plan = planRoles(
      'staging',
      states([['teko_watch', { neonSuperuser: false, ownerAdmin: false }]]),
      none,
      false,
    )
    assert.equal(plan[1]?.action, 'recreate')
    assert.match(plan[1]?.reason ?? '', /ADMIN/)
  })

  it('mantém o role criado por SQL com os segredos gravados', () => {
    const plan = planRoles(
      'production',
      states([
        ['teko_app', SQL_ROLE],
        ['teko_watch', SQL_ROLE],
      ]),
      ALL_PROD_SECRETS,
      false,
    )
    assert.deepEqual(describePlan(plan, 'production'), [
      'teko_app: keep (criado por SQL, com os segredos gravados); destinos: nenhum',
      'teko_watch: keep (criado por SQL, com os segredos gravados); destinos: nenhum',
    ])
  })

  it('segredo faltando troca a senha e regrava todos os destinos do role', () => {
    const secrets = new Map([
      ['staging', new Set(['NEON_STAGING_APP_URL'])],
      ['maintenance', new Set<string>()],
      ['corpus-watch', new Set(['NEON_STAGING_WATCH_URL'])],
    ])
    const plan = planRoles(
      'staging',
      states([
        ['teko_app', SQL_ROLE],
        ['teko_watch', SQL_ROLE],
      ]),
      secrets,
      false,
    )
    assert.equal(plan[0]?.action, 'reset')
    assert.deepEqual(plan[0]?.secrets, SECRET_TARGETS.staging.teko_app)
    assert.equal(plan[0]?.vercel, true)
    assert.equal(plan[1]?.action, 'keep')
  })

  it('com --reset-password troca a senha dos roles criados por SQL', () => {
    const plan = planRoles(
      'production',
      states([
        ['teko_app', SQL_ROLE],
        ['teko_watch', SQL_ROLE],
      ]),
      ALL_PROD_SECRETS,
      true,
    )
    assert.deepEqual(
      plan.map(({ action }) => action),
      ['reset', 'reset'],
    )
    assert.ok(
      describePlan(plan, 'production')[0]?.endsWith(
        'destinos: maintenance/NEON_PROD_APP_URL, vercel(production)/DATABASE_URL',
      ),
    )
  })

  it('o teko_watch nunca vai para um environment com credencial de escrita no corpus', () => {
    for (const target of ['staging', 'production'] as const) {
      for (const { environment } of SECRET_TARGETS[target].teko_watch) {
        assert.equal(environment, 'corpus-watch')
      }
    }
  })
})

describe('generatePassword', () => {
  it('tem o tamanho, as quatro classes e só caracteres seguros em URL e SQL', () => {
    for (let run = 0; run < 50; run += 1) {
      const password = generatePassword()
      assert.equal(password.length, PASSWORD_LENGTH)
      assert.match(password, /^[A-Za-z0-9_-]+$/)
      assert.match(password, /[a-z]/)
      assert.match(password, /[A-Z]/)
      assert.match(password, /\d/)
      assert.match(password, /[-_]/)
      assert.doesNotMatch(password, /(.)\1\1/)
      assert.equal(encodeURIComponent(password), password)
    }
  })

  it('descarta a tentativa sem todas as classes ou com caractere repetido três vezes', () => {
    // Primeira tentativa: só "a" (repetido e sem as outras classes); depois, um ciclo válido.
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'
    let calls = 0
    const cycle = ['a', 'B', '3', '-'].map((char) => alphabet.indexOf(char))
    const pick = () => {
      calls += 1
      return calls <= PASSWORD_LENGTH ? 0 : (cycle[(calls - 1) % cycle.length] ?? 0)
    }
    const password = generatePassword(pick)
    assert.equal(calls, PASSWORD_LENGTH * 2)
    assert.match(password, /^(?:aB3-)+$/)
  })
})

describe('SQL', () => {
  it('escapa identificador e literal', () => {
    assert.equal(quoteIdent('a"b'), '"a""b"')
    assert.equal(quoteLiteral("a'b"), "'a''b'")
  })

  it('cria e troca a senha com o role entre aspas e a senha como literal', () => {
    assert.equal(
      createRoleSql('teko_app', 'Senha-1'),
      `CREATE ROLE "teko_app" WITH LOGIN PASSWORD 'Senha-1'`,
    )
    assert.equal(resetPasswordSql('teko_watch', 'x'), `ALTER ROLE "teko_watch" WITH PASSWORD 'x'`)
  })

  it('revoga tabelas, sequências, esquemas, default privileges e o banco antes de apagar', () => {
    const sql = revokeSql('teko_watch')
    for (const fragment of [
      "ARRAY['app', 'auth', 'corpus']",
      'REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I',
      'REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I',
      'REVOKE ALL ON SCHEMA %I FROM %I',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON TABLES FROM %I',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM %I',
      'REVOKE ALL ON DATABASE %I FROM %I',
      "'teko_watch'",
    ]) {
      assert.ok(sql.includes(fragment), fragment)
    }
  })
})

describe('withCredentials', () => {
  const owner =
    'postgresql://neondb_owner:segredo@ep-x-123-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'

  it('troca usuário e senha e mantém host, banco e parâmetros', () => {
    const url = new URL(withCredentials(owner, 'teko_app', 'Nova-Senha_1'))
    assert.equal(url.username, 'teko_app')
    assert.equal(url.password, 'Nova-Senha_1')
    assert.equal(url.hostname, 'ep-x-123-pooler.sa-east-1.aws.neon.tech')
    assert.equal(url.pathname, '/neondb')
    assert.equal(url.searchParams.get('sslmode'), 'require')
    assert.equal(url.searchParams.get('channel_binding'), 'require')
  })

  it('recusa URL sem -pooler', () => {
    assert.throws(() => withCredentials(owner.replace('-pooler', ''), 'teko_app', 'x'), /-pooler/)
  })
})
