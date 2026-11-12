import { describe, expect, it } from 'vitest'
import { Modality, ReviewStatus, ValidityBasis } from './family.ts'
import {
  applyOverrides,
  DuplicateOverrideError,
  indexOverrides,
  type NoteHasher,
  type Override,
  OverrideAction,
  overrideFileSchema,
  overrideKey,
  overrideSchema,
} from './overrides.ts'
import type { ParsedSource, ParsedVersion } from './parsed-source.ts'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const KEY = 'go:rcte:art:76:par:6'
const OTHER = 'go:rcte:art:76:par:7'

const noteHash: NoteHasher = (flag) => (flag.rawNote === 'nota A' ? HASH_A : HASH_B)

function version(overrides: Partial<ParsedVersion> = {}): ParsedVersion {
  return {
    displayLabel: 'RCTE, art. 76, § 6º',
    validDuring: { from: '2004-11-04', to: '2009-11-23' },
    modality: Modality.Mandatory,
    validityBasis: ValidityBasis.LegalEffect,
    retroactive: false,
    reviewStatus: ReviewStatus.Auto,
    text: '§ 6º texto',
    ...overrides,
  }
}

const pending = version({
  reviewStatus: ReviewStatus.Pending,
  review: { reason: 'note-unparsed', rawNote: 'nota A' },
})

function source(): ParsedSource {
  return {
    document: {
      slug: 'rcte',
      family: 'rcte',
      title: 'RCTE',
      issuer: 'Goiás',
      sourceUrl: 'https://appasp.economia.go.gov.br/Legislacao/arquivos/Rcte/RCTE.htm',
    },
    version: {
      versionLabel: 'RCTE',
      publishedOn: '2026-09-16',
      validDuring: { from: '2026-09-16', to: null },
      consolidatedUntil: null,
      actRef: null,
      sha256: 'c'.repeat(64),
    },
    replacementWindow: { from: null, to: null },
    provisions: [
      {
        stableKey: KEY,
        kind: 'paragrafo',
        sortPath: '0076.p06',
        headingPath: 'RCTE > Art. 76 > § 6º',
        versions: [version(), pending],
      },
      {
        stableKey: OTHER,
        kind: 'paragrafo',
        sortPath: '0076.p07',
        headingPath: 'RCTE > Art. 76 > § 7º',
        versions: [version({ review: { reason: 'x', rawNote: 'nota B' } })],
      },
    ],
    skipped: [],
    stats: { notesTotal: 2, notesParsed: 1, notesToReview: 1 },
  }
}

const base = {
  stable_key: KEY,
  note_hash: HASH_A,
  reason: 'conferido no DOE',
  reviewed_by: 'mantenedor',
  reviewed_at: '2026-11-11',
}

function parse(value: unknown): Override {
  return overrideSchema.parse(value)
}

describe('overrideSchema', () => {
  it('aceita as três ações e exige intervalo só em set_interval', () => {
    expect(parse({ ...base, action: 'approve' }).action).toBe(OverrideAction.Approve)
    expect(parse({ ...base, action: 'reject' }).action).toBe(OverrideAction.Reject)
    expect(
      parse({ ...base, action: 'set_interval', valid_during: { from: '2004-01-01', to: null } })
        .action,
    ).toBe(OverrideAction.SetInterval)
    expect(overrideSchema.safeParse({ ...base, action: 'set_interval' }).success).toBe(false)
    expect(
      overrideSchema.safeParse({
        ...base,
        action: 'approve',
        valid_during: { from: '2004-01-01', to: null },
      }).success,
    ).toBe(false)
  })

  it('recusa intervalo sem início, chave inválida e hash fora do formato', () => {
    expect(
      overrideSchema.safeParse({
        ...base,
        action: 'set_interval',
        valid_during: { from: null, to: '2004-01-01' },
      }).success,
    ).toBe(false)
    expect(overrideSchema.safeParse({ ...base, stable_key: 'x', action: 'approve' }).success).toBe(
      false,
    )
    expect(overrideSchema.safeParse({ ...base, note_hash: 'ABC', action: 'approve' }).success).toBe(
      false,
    )
  })

  it('recusa chave repetida no mesmo arquivo', () => {
    const entry = { ...base, action: 'approve' }
    expect(overrideFileSchema.safeParse([entry]).success).toBe(true)
    const result = overrideFileSchema.safeParse([entry, { ...entry, action: 'reject' }])
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain(overrideKey(KEY, HASH_A))
  })
})

describe('indexOverrides', () => {
  it('indexa por (stable_key, note_hash) e recusa repetição entre arquivos', () => {
    const approve = parse({ ...base, action: 'approve' })
    expect(indexOverrides([approve]).get(overrideKey(KEY, HASH_A))).toBe(approve)
    expect(() => indexOverrides([approve, approve])).toThrow(DuplicateOverrideError)
  })
})

describe('applyOverrides', () => {
  it('sem overrides devolve a mesma fonte', () => {
    const input = source()
    expect(applyOverrides(input, new Map(), noteHash)).toEqual({ source: input, applied: [] })
  })

  it('aprova a anomalia e tira o review, sem tocar as outras redações', () => {
    const input = source()
    const result = applyOverrides(
      input,
      indexOverrides([parse({ ...base, action: 'approve' })]),
      noteHash,
    )
    const [first, second] = result.source.provisions[0]?.versions ?? []
    expect(first).toBe(input.provisions[0]?.versions[0])
    expect(second?.reviewStatus).toBe(ReviewStatus.Approved)
    expect(second).not.toHaveProperty('review')
    expect(result.source.provisions[1]).toBe(input.provisions[1])
    expect(result.applied).toEqual([{ stableKey: KEY, noteHash: HASH_A, action: 'approve' }])
  })

  it('rejeita e troca o intervalo', () => {
    const rejected = applyOverrides(
      source(),
      indexOverrides([parse({ ...base, action: 'reject' })]),
      noteHash,
    )
    expect(rejected.source.provisions[0]?.versions[1]?.reviewStatus).toBe(ReviewStatus.Rejected)

    const interval = { from: '2004-11-04', to: '2009-11-24' }
    const replaced = applyOverrides(
      source(),
      indexOverrides([parse({ ...base, action: 'set_interval', valid_during: interval })]),
      noteHash,
    )
    const resolved = replaced.source.provisions[0]?.versions[1]
    expect(resolved?.validDuring).toEqual(interval)
    expect(resolved?.reviewStatus).toBe(ReviewStatus.Approved)
    expect(resolved?.text).toBe('§ 6º texto')
  })

  it('ignora override de outra nota ou de outro dispositivo', () => {
    const result = applyOverrides(
      source(),
      indexOverrides([
        parse({ ...base, note_hash: HASH_B, action: 'approve' }),
        parse({ ...base, stable_key: 'go:rcte:art:1', action: 'approve' }),
      ]),
      noteHash,
    )
    expect(result.applied).toEqual([])
    expect(result.source.provisions[0]?.versions[1]?.reviewStatus).toBe(ReviewStatus.Pending)
  })
})
