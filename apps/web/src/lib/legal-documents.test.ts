import { describe, expect, it } from 'vitest'
import en from '../../messages/en.json'
import ptBR from '../../messages/pt-BR.json'
import {
  ABOUT_SECTIONS,
  LEGAL_RICH_TAGS,
  PRIVACY_SECTIONS,
  sectionAnchor,
  TERMS_SECTIONS,
} from './legal-documents.ts'

describe('seções dos documentos', () => {
  it.each([
    ['privacy', PRIVACY_SECTIONS, ptBR.legal.privacy.sections, en.legal.privacy.sections],
    ['terms', TERMS_SECTIONS, ptBR.legal.terms.sections, en.legal.terms.sections],
    ['about', ABOUT_SECTIONS, ptBR.about.sections, en.about.sections],
  ])(
    '%s: a lista tem exatamente as seções do catálogo, na mesma ordem',
    (_doc, list, pt, english) => {
      expect(Object.keys(pt)).toEqual([...list])
      expect(Object.keys(english)).toEqual([...list])
    },
  )

  it.each([
    ['privacy', PRIVACY_SECTIONS],
    ['terms', TERMS_SECTIONS],
    ['about', ABOUT_SECTIONS],
  ] as const)('%s: âncoras únicas e válidas', (_doc, list: readonly string[]) => {
    const anchors = list.map(sectionAnchor)
    expect(new Set(anchors).size).toBe(anchors.length)
    for (const anchor of anchors) expect(anchor).toMatch(/^[a-z]+(-[a-z]+)*$/)
  })
})

describe('sectionAnchor', () => {
  it('troca camelCase por kebab-case', () => {
    expect(sectionAnchor('acceptableUse')).toBe('acceptable-use')
    expect(sectionAnchor('summary')).toBe('summary')
  })
})

describe('tags de rich text', () => {
  it.each([
    ['pt-BR', ptBR],
    ['en', en],
  ])('%s: legal e about só usam tags que o componente implementa', (_locale, messages) => {
    const text = JSON.stringify([messages.legal, messages.about])
    const used = new Set([...text.matchAll(/<([A-Za-z]\w*)>/g)].map((match) => match[1]))
    const known = new Set<string>(LEGAL_RICH_TAGS)
    expect([...used].filter((tag) => tag !== undefined && !known.has(tag))).toEqual([])
  })
})

describe('conteúdo legal obrigatório', () => {
  it.each([
    ['pt-BR', ptBR],
    ['en', en],
  ])(
    '%s: a política cita a retenção de 90 dias e os direitos em /settings',
    (_locale, messages) => {
      const text = JSON.stringify(messages.legal.privacy)
      expect(text).toContain('90')
      expect(text).toContain('<settings>')
    },
  )

  it.each([
    ['pt-BR', ptBR, '1 ano', '14 dias'],
    ['en', en, '1 year', '14 days'],
  ])(
    '%s: a política lista os operadores de observabilidade e as retenções deles',
    (_locale, messages, posthogRetention, grafanaRetention) => {
      const { providers, retention } = messages.legal.privacy.sections
      for (const operator of ['PostHog', 'Langfuse', 'Grafana Labs']) {
        expect(providers.body).toContain(operator)
      }
      expect(retention.body).toContain(posthogRetention)
      expect(retention.body).toContain(grafanaRetention)
    },
  )

  it('os termos têm o aviso de que o Tekó não constitui parecer, igual ao do rodapé', () => {
    expect(JSON.stringify(ptBR.legal.terms)).toContain('Apoio à consulta; não constitui parecer')
  })
})
