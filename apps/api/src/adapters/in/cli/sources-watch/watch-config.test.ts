import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { repoPath } from '../../../../../test/setup/repo-root.ts'
import { loadWatchConfig, parseWatchConfig, WatchConfigError } from './watch-config.ts'

const REPO_WATCH = repoPath('corpus', 'watch.yaml')

describe('corpus/watch.yaml', () => {
  it('é válido e cobre as páginas do plano', async () => {
    const pages = await loadWatchConfig(REPO_WATCH)
    expect(pages.map((page) => page.id)).toEqual([
      'rcte-consolidado',
      'rcte-decretos-atualizadores',
      'rcte-decretos-do-ano',
      'cte-consolidado',
      'cte-leis-atualizadoras',
      'sped-efd-icms-ipi-documentos',
      'sped-efd-reinf-leiautes',
      'efd-go-guia-pratico',
      'sped-tabelas-go',
    ])
    expect(new Set(pages.map((page) => page.family))).toEqual(
      new Set(['rcte', 'cte', 'efd-icms-ipi', 'efd-reinf', 'efd-go', 'tabelas-go']),
    )
    const ws = pages.find((page) => page.kind === 'tables-ws')
    expect(ws).toMatchObject({ tableIds: [37, 38, 39, 40], mode: 'live', encoding: 'utf-8' })
    const hosts = new Set(pages.map((page) => new URL(page.url.replace('{yyyy}', '2026')).host))
    expect(hosts).toEqual(
      new Set([
        'appasp.economia.go.gov.br',
        'www.gov.br',
        'goias.gov.br',
        'www.sped.fazenda.gov.br',
      ]),
    )
  })

  it('todo `covers` é um documento da mesma família no corpus/sources.yaml', async () => {
    const sources = parse(readFileSync(repoPath('corpus', 'sources.yaml'), 'utf8')) as {
      documents: { slug: string; family: string }[]
    }
    const familyOf = new Map(sources.documents.map((document) => [document.slug, document.family]))
    const pages = await loadWatchConfig(REPO_WATCH)
    const covers = pages.flatMap((page) => [
      ...(page.covers ?? []).map((slug) => [page.family, slug] as const),
      ...(page.kind === 'document-index'
        ? page.documents.flatMap((document) =>
            (document.covers ?? []).map((slug) => [page.family, slug] as const),
          )
        : []),
    ])
    expect(covers.length).toBeGreaterThan(0)
    for (const [family, slug] of covers) {
      expect(familyOf.get(slug), slug).toBe(family)
    }
  })
})

describe('parseWatchConfig', () => {
  const page = `
  - id: a
    family: rcte
    kind: consolidated
    url: https://x.gov.br/a.htm`

  it('aplica os padrões de mode e encoding', () => {
    expect(parseWatchConfig(`version: 1\npages:${page}`)).toEqual([
      {
        id: 'a',
        family: 'rcte',
        kind: 'consolidated',
        url: 'https://x.gov.br/a.htm',
        mode: 'live',
        encoding: 'utf-8',
        covers: [],
      },
    ])
  })

  it.each([
    ['YAML inválido', 'version: [', /YAML inválido/],
    ['id repetido', `version: 1\npages:${page}${page}`, /id repetido: a/],
    [
      'família desconhecida',
      'version: 1\npages:\n  - {id: a, family: nfe, kind: consolidated, url: "https://x.gov.br"}',
      /família desconhecida/,
    ],
    [
      'URL http',
      'version: 1\npages:\n  - {id: a, family: rcte, kind: consolidated, url: "http://x.gov.br"}',
      /URL https/,
    ],
    [
      'URL inválida',
      'version: 1\npages:\n  - {id: a, family: rcte, kind: consolidated, url: "nada"}',
      /URL https/,
    ],
    [
      'regex inválido',
      'version: 1\npages:\n  - {id: a, family: rcte, kind: act-list, act: lei, include: "(", url: "https://x.gov.br"}',
      /regex inválido/,
    ],
    [
      'campo desconhecido',
      'version: 1\npages:\n  - {id: a, family: rcte, kind: consolidated, url: "https://x.gov.br", x: 1}',
      /pages\.0/,
    ],
    [
      'tables-ws sem tabelas',
      'version: 1\npages:\n  - {id: a, family: tabelas-go, kind: tables-ws, url: "https://x.gov.br", tableIds: []}',
      /tableIds/,
    ],
  ])('recusa %s', (_name, text, message) => {
    expect(() => parseWatchConfig(text, 'teste.yaml')).toThrow(WatchConfigError)
    expect(() => parseWatchConfig(text, 'teste.yaml')).toThrow(message)
  })
})
