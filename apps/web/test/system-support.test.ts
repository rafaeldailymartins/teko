import { describe, expect, it } from 'vitest'
import pool from '../system/questions.json' with { type: 'json' }
import {
  importSignCount,
  PasskeySecretError,
  parsePasskey,
  STAGING_RP_ID,
} from '../system/support/passkey.ts'
import {
  coveredPeriodos,
  type FamilyCoverage,
  outOfCoveragePeriodo,
  parseCoverage,
  parsePool,
  pickPeriodo,
  pickQuestion,
  RECENT_MONTHS,
  runNumber,
} from '../system/support/plan.ts'

/**
 * Partes puras do system test do staging (`system/`): o formato do segredo da passkey e as
 * escolhas de pergunta e data. O roteiro em si só roda contra o staging (`system-test.yml`).
 */

const SECRET = {
  version: 1,
  rpId: STAGING_RP_ID,
  credentialId: 'q83v-A',
  privateKey: 'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg',
  userHandle: 'dXNlci1pZA',
  signCount: 3,
}

describe('parsePasskey', () => {
  it('aceita base64url e devolve base64 padrão, como o CDP espera', () => {
    expect(parsePasskey(JSON.stringify(SECRET))).toEqual({
      version: 1,
      rpId: 'tekoia-staging.vercel.app',
      credentialId: 'q83v+A==',
      privateKey: SECRET.privateKey,
      userHandle: 'dXNlci1pZA==',
      signCount: 3,
    })
  })

  it.each([
    ['ausente', undefined],
    ['vazio', ' '],
    ['não JSON', 'abc'],
    ['sem version', JSON.stringify({ ...SECRET, version: 2 })],
    ['outro rpId', JSON.stringify({ ...SECRET, rpId: 'tekoia.vercel.app' })],
    ['signCount negativo', JSON.stringify({ ...SECRET, signCount: -1 })],
    ['chave privada ausente', JSON.stringify({ ...SECRET, privateKey: '' })],
    ['id que não é base64', JSON.stringify({ ...SECRET, credentialId: 'não!base64' })],
  ])('recusa segredo %s sem repetir o conteúdo', (_case, raw) => {
    expect(() => parsePasskey(raw)).toThrow(PasskeySecretError)
    try {
      parsePasskey(raw)
    } catch (error) {
      expect(String(error)).not.toContain(SECRET.privateKey)
    }
  })

  it('o contador da importação sempre passa do guardado pelo servidor', () => {
    const passkey = parsePasskey(JSON.stringify(SECRET))
    const first = importSignCount(passkey, Date.parse('2026-11-18T12:00:00Z'))
    const next = importSignCount(passkey, Date.parse('2026-11-18T12:05:00Z'))
    expect(first).toBe(Math.floor(Date.parse('2026-11-18T12:00:00Z') / 1000))
    expect(next).toBeGreaterThan(first)
    expect(next).toBeLessThan(2 ** 32)
    expect(importSignCount({ ...passkey, signCount: 2 ** 31 }, 0)).toBe(2 ** 31 + 1)
  })
})

const COVERAGE: FamilyCoverage[] = [
  {
    family: 'efd-icms-ipi',
    covered: [{ from: '2021-01-01', to: null }],
    verifiedAt: '2026-11-17',
  },
  {
    family: 'rcte',
    covered: [
      { from: '2004-11-04', to: '2010-01-01' },
      { from: '2026-10-15', to: null },
    ],
    verifiedAt: '2026-11-17',
  },
]

describe('pool de perguntas', () => {
  it('o pool versionado tem 30 perguntas válidas, de famílias do corpus', () => {
    const questions = parsePool(pool)
    expect(questions).toHaveLength(30)
    const families = new Set(questions.map((item) => item.family))
    expect([...families].sort()).toEqual([
      'cte',
      'efd-go',
      'efd-icms-ipi',
      'efd-reinf',
      'rcte',
      'tabelas-go',
    ])
  })

  it('recusa pool sem 30 perguntas, com item inválido ou repetido', () => {
    const questions = parsePool(pool)
    expect(() => parsePool(questions.slice(1))).toThrow(/30 perguntas/)
    expect(() => parsePool([...questions.slice(1), { family: 'rcte' }])).toThrow(/item 29/)
    expect(() => parsePool([...questions.slice(1), questions[1]])).toThrow(/repetida/)
  })

  it('a pergunta e a data giram com o número do run', () => {
    const questions = parsePool(pool)
    expect(pickQuestion(questions, 0)).toBe(questions[0])
    expect(pickQuestion(questions, 31)).toBe(questions[1])
    expect(runNumber('42')).toBe(42)
    expect(runNumber(undefined)).toBe(0)
    expect(runNumber('-3')).toBe(0)
    expect(runNumber('abc')).toBe(0)
    const efd = { family: 'efd-icms-ipi', question: 'Quais campos o registro C170 tem?' }
    expect(pickPeriodo(COVERAGE, efd, 0, 30)).toBe('2026-11')
    expect(pickPeriodo(COVERAGE, efd, 30, 30)).toBe('2026-10')
    expect(pickPeriodo(COVERAGE, efd, 30 * RECENT_MONTHS, 30)).toBe('2026-11')
    expect(() => pickPeriodo(COVERAGE, { family: 'cte', question: 'x'.repeat(12) }, 0, 30)).toThrow(
      /cte não cobre/,
    )
  })
})

describe('datas a partir da cobertura', () => {
  it('meses cobertos: o primeiro dia dentro do intervalo e até o verifiedAt', () => {
    const rcte = COVERAGE[1] as FamilyCoverage
    const periodos = coveredPeriodos(rcte)
    expect(periodos.slice(0, 2)).toEqual(['2026-11', '2009-12'])
    expect(periodos).toHaveLength(RECENT_MONTHS)
    expect(periodos).not.toContain('2026-10')
  })

  it('fora da cobertura: antes do início mais antigo, ou depois da verificação', () => {
    expect(outOfCoveragePeriodo(COVERAGE)).toBe('2004-10')
    const open = [{ family: 'x', covered: [{ from: null, to: null }], verifiedAt: '2026-11-17' }]
    expect(outOfCoveragePeriodo(open)).toBe('2026-12')
  })

  it('lê o corpo do GET /api/v1/coverage', () => {
    expect(
      parseCoverage({
        corpusVersion: 3,
        families: [
          {
            family: 'rcte',
            jurisdiction: 'GO',
            covered: [{ from: '2004-11-04', to: null }],
            verifiedAt: '2026-11-17',
          },
        ],
      }),
    ).toEqual([
      { family: 'rcte', covered: [{ from: '2004-11-04', to: null }], verifiedAt: '2026-11-17' },
    ])
    expect(() => parseCoverage({ families: [] })).toThrow(/sem famílias/)
    expect(() => parseCoverage({ families: [{ family: 'rcte', covered: [] }] })).toThrow(
      /verifiedAt/,
    )
  })
})
