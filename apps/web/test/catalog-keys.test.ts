import { describe, expect, it } from 'vitest'
import { diffCatalogKeys, flattenCatalog } from './catalog-keys.ts'

describe('flattenCatalog', () => {
  it('achata namespaces aninhados e mantém listas e números como folha', () => {
    expect([
      ...flattenCatalog({ a: { b: 'x', c: { d: 'y' } }, e: ['z'], f: 1, g: null }).entries(),
    ]).toEqual([
      ['a.b', 'x'],
      ['a.c.d', 'y'],
      ['e', ['z']],
      ['f', 1],
      ['g', null],
    ])
  })
})

describe('diffCatalogKeys', () => {
  const reference = { legal: { title: 'Título', toc: 'Sumário' }, consent: { accept: 'Aceitar' } }

  it('catálogos com as mesmas chaves não têm diferença', () => {
    expect(diffCatalogKeys(reference, structuredClone(reference))).toEqual({
      missing: [],
      extra: [],
    })
  })

  it('aponta a chave faltando no outro idioma', () => {
    expect(
      diffCatalogKeys(reference, { legal: { title: 'Title' }, consent: { accept: 'Accept' } }),
    ).toEqual({ missing: ['legal.toc'], extra: [] })
  })

  it('aponta a chave sobrando, inclusive um namespace inteiro', () => {
    expect(
      diffCatalogKeys(reference, {
        ...reference,
        consent: { accept: 'Accept', reject: 'Reject' },
        about: { title: 'About' },
      }),
    ).toEqual({ missing: [], extra: ['about.title', 'consent.reject'] })
  })

  it('folha no lugar de namespace conta como falta e sobra', () => {
    expect(diffCatalogKeys(reference, { ...reference, legal: 'Legal' })).toEqual({
      missing: ['legal.title', 'legal.toc'],
      extra: ['legal'],
    })
  })
})
