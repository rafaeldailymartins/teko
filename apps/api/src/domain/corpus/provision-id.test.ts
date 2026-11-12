import { test } from '@fast-check/vitest'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Family } from './family.ts'
import {
  buildStableKey,
  InvalidStableKeyError,
  isSameOrDescendant,
  isStableKey,
  parentStableKey,
  parseStableKey,
  STABLE_KEY_MAX_LENGTH,
  type StableKeySegment,
} from './provision-id.ts'

describe('parseStableKey', () => {
  it('lê as chaves canônicas do plano', () => {
    expect(parseStableKey('go:rcte:art:76:par:6:inc:II')).toEqual({
      jurisdiction: 'go',
      family: 'rcte',
      segments: [
        { kind: 'art', value: '76' },
        { kind: 'par', value: '6' },
        { kind: 'inc', value: 'II' },
      ],
    })
    expect(parseStableKey('br:efd-icms-ipi:reg:C170:campo:07').segments).toEqual([
      { kind: 'reg', value: 'C170' },
      { kind: 'campo', value: '07' },
    ])
    for (const key of [
      'br:efd-reinf:evt:R-2010:grupo:infoServTom:campo:vlrTotalBruto',
      'go:tabelas-go:tab:5-1-1:cod:GO000001',
      'go:rcte:art:76-A:par:unico:inc:IV-A:ali:b-1:item:2-1',
      'go:rcte:art:167-S-B:par:1',
      'go:efd-go:cap:III:sec:2:item:5',
      'go:rcte-anexos:anexo:VIII:item:1',
      'br:efd-icms-ipi:nt:2025-001:item:3-1',
      'br:efd-reinf:nt:2026-005',
    ]) {
      expect(isStableKey(key)).toBe(true)
    }
  })

  it.each([
    ['sp:rcte:art:1', 'jurisdição deve ser br ou go'],
    ['go:icms:art:1', 'família desconhecida'],
    ['br:rcte:art:1', 'jurisdição não corresponde à família'],
    ['go:rcte', 'segmentos devem vir em pares tipo:valor'],
    ['go:rcte:art', 'segmentos devem vir em pares tipo:valor'],
    ['go:rcte:artigo:1', 'tipo de segmento desconhecido: artigo'],
    ['go:rcte:art:abc', 'valor inválido para art: abc'],
    ['go:rcte:art:167-S-B-C', 'valor inválido para art: 167-S-B-C'],
    ['go:rcte:inc:2', 'valor inválido para inc: 2'],
    ['br:efd-icms-ipi:reg:Z100', 'valor inválido para reg: Z100'],
    ['br:efd-icms-ipi:nt:2025001', 'valor inválido para nt: 2025001'],
    ['br:efd-icms-ipi:nt:25-001', 'valor inválido para nt: 25-001'],
    ['go:rcte:art:1:toString:x', 'tipo de segmento desconhecido: toString'],
  ])('rejeita %s (%s)', (key, reason) => {
    expect(() => parseStableKey(key)).toThrow(new InvalidStableKeyError(key, reason))
    expect(isStableKey(key)).toBe(false)
  })

  it('rejeita chave longa demais e valores que não são texto', () => {
    const long = `go:rcte${':item:1'.repeat(40)}`
    expect(long.length).toBeGreaterThan(STABLE_KEY_MAX_LENGTH)
    expect(() => parseStableKey(long)).toThrow(/longa demais/)
    expect(isStableKey(76)).toBe(false)
    expect(isStableKey(null)).toBe(false)
  })

  it('o erro guarda a chave e tem nome próprio', () => {
    const error = new InvalidStableKeyError('x', 'motivo')
    expect(error.name).toBe('InvalidStableKeyError')
    expect(error.key).toBe('x')
    expect(error.message).toBe('stable_key inválida (motivo): "x"')
  })
})

describe('buildStableKey, parentStableKey e isSameOrDescendant', () => {
  it('monta a chave com o prefixo da jurisdição da família', () => {
    expect(
      buildStableKey(Family.Rcte, [
        { kind: 'art', value: '76' },
        { kind: 'par', value: '6' },
      ]),
    ).toBe('go:rcte:art:76:par:6')
    expect(buildStableKey(Family.EfdIcmsIpi, [{ kind: 'reg', value: 'C100' }])).toBe(
      'br:efd-icms-ipi:reg:C100',
    )
    expect(() => buildStableKey(Family.Rcte, [{ kind: 'art', value: 'x' }])).toThrow(
      InvalidStableKeyError,
    )
  })

  it('o pai tira o último segmento; o primeiro nível não tem pai', () => {
    expect(parentStableKey('go:rcte:art:76:par:6:inc:II')).toBe('go:rcte:art:76:par:6')
    expect(parentStableKey('go:rcte:art:76:par:6')).toBe('go:rcte:art:76')
    expect(parentStableKey('go:rcte:art:76')).toBeNull()
  })

  it('descendente é a própria chave ou um prefixo de segmentos completos', () => {
    expect(isSameOrDescendant('go:rcte:art:76', 'go:rcte:art:76')).toBe(true)
    expect(isSameOrDescendant('go:rcte:art:76:par:6', 'go:rcte:art:76')).toBe(true)
    expect(isSameOrDescendant('go:rcte:art:760', 'go:rcte:art:76')).toBe(false)
    expect(isSameOrDescendant('go:rcte:art:7', 'go:rcte:art:76')).toBe(false)
  })
})

const segmentArb: fc.Arbitrary<StableKeySegment> = fc.oneof(
  fc.integer({ min: 1, max: 9999 }).map((n) => ({ kind: 'art' as const, value: String(n) })),
  fc.integer({ min: 1, max: 99 }).map((n) => ({ kind: 'par' as const, value: String(n) })),
  fc.constantFrom('I', 'II', 'IV', 'IX', 'XL').map((value) => ({ kind: 'inc' as const, value })),
  fc.constantFrom('a', 'b', 'z').map((value) => ({ kind: 'ali' as const, value })),
  fc.integer({ min: 1, max: 999 }).map((n) => ({ kind: 'item' as const, value: String(n) })),
)

describe('propriedades', () => {
  test.prop([
    fc.constantFrom(Family.Rcte, Family.Cte),
    fc.array(segmentArb, { minLength: 1, maxLength: 5 }),
  ])('build e parse são inversos', (family, segments) => {
    const key = buildStableKey(family, segments)
    const parsed = parseStableKey(key)
    expect(parsed.family).toBe(family)
    expect(parsed.segments).toEqual(segments)
    expect(buildStableKey(parsed.family, parsed.segments)).toBe(key)
  })

  test.prop([
    fc.constantFrom(Family.Rcte, Family.Cte),
    fc.array(segmentArb, { minLength: 2, maxLength: 5 }),
  ])('toda chave é descendente do pai', (family, segments) => {
    const key = buildStableKey(family, segments)
    const parent = parentStableKey(key)
    expect(parent).not.toBeNull()
    expect(isSameOrDescendant(key, parent ?? '')).toBe(true)
  })
})
