import { describe, expect, it } from 'vitest'
import { repoPath } from '../../../../../test/setup/repo-root.ts'
import {
  allowedHostsOf,
  buildCorpusConfig,
  CorpusConfigError,
  HTTP_PINNED_HOSTS,
  httpHostsOf,
  loadCorpusConfig,
  type ResolvedSource,
} from './sources.ts'

const CORPUS_DIR = repoPath('corpus')

function byId(sources: readonly ResolvedSource[], id: string): ResolvedSource {
  const source = sources.find((entry) => entry.id === id)
  if (source === undefined) {
    throw new Error(`fonte ausente: ${id}`)
  }
  return source
}

describe('corpus/sources.yaml e corpus/leiaute-periods.yaml reais', () => {
  const config = loadCorpusConfig(CORPUS_DIR)
  const resolved = config.resolved

  it('validam juntos e cobrem as famílias das ondas C1 e C2', () => {
    expect(new Set(resolved.map((source) => source.family))).toEqual(
      new Set(['efd-icms-ipi', 'efd-reinf', 'rcte', 'cte', 'efd-go', 'tabelas-go']),
    )
    expect(resolved.filter((source) => source.family === 'efd-go')).toHaveLength(18)
    expect(
      resolved.filter((source) => source.family === 'tabelas-go').map((s) => s.wsTableId),
    ).toEqual([37, 38, 39, 40])
  })

  it('toda fonte habilitada é https (ou fixada em http no host com exceção) e toda pinned tem sha256', () => {
    for (const source of resolved) {
      const url = new URL(source.url)
      if (url.protocol === 'http:') {
        expect(HTTP_PINNED_HOSTS.has(url.hostname), source.id).toBe(true)
        expect(source.mode, source.id).toBe('pinned')
      } else {
        expect(url.protocol, source.id).toBe('https:')
      }
      if (source.mode === 'pinned') {
        expect(source.sha256, source.id).toMatch(/^[0-9a-f]{64}$/)
      }
    }
  })

  it('resolve os Guias do portal antigo (2021 a 2024) pelo leiaute de cada ano', () => {
    const expected: Record<string, { from: string; to: string }> = {
      '3.0.6': { from: '2021-01-01', to: '2022-01-01' },
      '3.0.8': { from: '2022-01-01', to: '2023-01-01' },
      '3.1.2': { from: '2023-01-01', to: '2024-01-01' },
      '3.1.3': { from: '2023-01-01', to: '2024-01-01' },
      '3.1.6': { from: '2024-01-01', to: '2025-01-01' },
    }
    for (const [version, validDuring] of Object.entries(expected)) {
      const source = byId(resolved, `efd-icms-ipi/guia-pratico/${version}`)
      expect(source.versionValidDuring, version).toEqual(validDuring)
      expect(source.url, version).toMatch(/^http:\/\/sped\.rfb\.gov\.br\//)
      expect(source.pageRanges.length, version).toBe(3)
    }
  })

  it('reproduz as vigências da fixture da F2 (Guia, REINF, EFD-GO)', () => {
    expect(byId(resolved, 'efd-icms-ipi/guia-pratico/3.1.9').versionValidDuring).toEqual({
      from: '2025-01-01',
      to: '2026-01-01',
    })
    for (const version of ['3.2.0', '3.2.1', '3.2.2', '3.2.3', '3.2.4']) {
      expect(byId(resolved, `efd-icms-ipi/guia-pratico/${version}`).versionValidDuring).toEqual({
        from: '2026-01-01',
        to: null,
      })
    }
    expect(byId(resolved, 'efd-reinf/leiautes/2.1.1').versionValidDuring).toEqual({
      from: '2023-03-01',
      to: '2023-09-01',
    })
    expect(byId(resolved, 'efd-reinf/leiautes/2.1.2').versionValidDuring).toEqual({
      from: '2023-09-01',
      to: null,
    })
    expect(byId(resolved, 'efd-go/guia-pratico/5.8').versionValidDuring).toEqual({
      from: '2025-10-02',
      to: '2026-03-16',
    })
    expect(byId(resolved, 'efd-go/guia-pratico/5.9').versionValidDuring).toEqual({
      from: '2026-03-16',
      to: null,
    })
    const guia = byId(resolved, 'efd-icms-ipi/guia-pratico/3.2.4')
    expect(guia.document.slug).toBe('guia-pratico-efd-icms-ipi')
    expect(guia.versionLabel).toBe(
      'Guia Prático EFD-ICMS/IPI versão 3.2.4 (atualização de 30/07/2026)',
    )
    expect(guia.actRef).toBe('Ato COTEPE/ICMS nº 44/2018')
    expect(guia.pageRanges).toEqual(['1-125', '126-250', '251-366'])
  })

  it('NT recebe o período do leiaute e as datas de efeito padrão', () => {
    const nt = byId(resolved, 'efd-icms-ipi/nt/2025-001')
    expect(nt.versionValidDuring).toEqual({ from: '2026-01-01', to: '2027-01-01' })
    expect(nt.effectiveFrom).toBe('2026-01-01')
    expect(nt.mandatoryFrom).toBe('2026-01-01')
    expect(nt.optionalFrom).toBeNull()
    expect(byId(resolved, 'efd-icms-ipi/nt/2026-001').versionValidDuring).toEqual({
      from: '2027-01-01',
      to: null,
    })
  })

  it('consolidados e tabelas ficam sem vigência de documento', () => {
    const rcte = byId(resolved, 'rcte/consolidado')
    expect(rcte).toMatchObject({
      mode: 'live',
      yearPivot: 97,
      versionValidDuring: null,
      versionLabel: null,
    })
    expect(byId(resolved, 'cte/consolidado').yearPivot).toBe(91)
    expect(byId(resolved, 'tabelas-go/5-5')).toMatchObject({ mode: 'ws-tabela', publishedOn: null })
  })

  it('não carrega fontes desabilitadas', () => {
    expect(resolved.some((source) => source.id === 'efd-icms-ipi/guia-pratico/3.1.8')).toBe(false)
    expect(resolved.some((source) => source.id.startsWith('efd-reinf/nt/'))).toBe(false)
  })

  it('a allowlist do SafeFetcher tem só os hosts oficiais, e a exceção http só o portal antigo', () => {
    expect(allowedHostsOf(config)).toEqual([
      'appasp.economia.go.gov.br',
      'goias.gov.br',
      'sped.rfb.gov.br',
      'www.gov.br',
      'www.sped.fazenda.gov.br',
    ])
    expect(httpHostsOf(config)).toEqual(['sped.rfb.gov.br'])
  })
})

const LEIAUTES = {
  version: 1,
  series: {
    'efd-icms-ipi': {
      title: 'Leiautes',
      source_url: 'https://www.confaz.fazenda.gov.br/x',
      periods: [
        { code: '019', from: '2025-01-01', to: '2026-01-01', act: 'Ato 1' },
        { code: '020', from: '2026-01-01', to: null, act: 'Ato 2' },
      ],
    },
  },
}

function guiaDocument(sources: unknown[]) {
  return {
    slug: 'guia',
    family: 'efd-icms-ipi',
    title: 'Guia',
    issuer: 'SPED',
    source_url: 'https://www.gov.br/sped',
    parser: 'docling-guia',
    validity: 'leiaute',
    sources,
  }
}

const GUIA_SOURCE = {
  id: 'efd-icms-ipi/guia/1',
  version: '1',
  version_label: 'Guia 1',
  url: 'https://www.gov.br/guia-1.pdf',
  mode: 'pinned',
  sha256: 'a'.repeat(64),
  format: 'pdf',
  published_on: '2025-05-01',
  leiaute: '019',
}

function problems(documents: unknown[], leiautes: unknown = LEIAUTES): string {
  try {
    buildCorpusConfig({ version: 1, documents }, leiautes)
  } catch (error) {
    expect(error).toBeInstanceOf(CorpusConfigError)
    return error instanceof Error ? error.message : ''
  }
  throw new Error('deveria ter falhado')
}

describe('buildCorpusConfig: validação', () => {
  it('aceita um documento mínimo e resolve a vigência pelo leiaute', () => {
    const config = buildCorpusConfig(
      { version: 1, documents: [guiaDocument([GUIA_SOURCE])] },
      LEIAUTES,
    )
    expect(config.resolved[0]?.versionValidDuring).toEqual({ from: '2025-01-01', to: null })
  })

  it.each([
    [{ ...GUIA_SOURCE, sha256: undefined }, /sha256: obrigatório no modo pinned/],
    [{ ...GUIA_SOURCE, url: 'http://www.gov.br/1' }, /URL https; http só em sped.rfb.gov.br/],
    [{ ...GUIA_SOURCE, url: 'http://sped.rfb.gov.br/1', mode: 'live' }, /modo pinned/],
    [{ ...GUIA_SOURCE, url: 'http://sped.rfb.gov.br/1', sha256: undefined }, /sha256: obrigatório/],
    [{ ...GUIA_SOURCE, leiaute: '999' }, /período de leiaute desconhecido/],
    [{ ...GUIA_SOURCE, leiaute: undefined }, /leiaute: obrigatório/],
    [{ ...GUIA_SOURCE, published_on: undefined }, /published_on: obrigatório/],
    [{ ...GUIA_SOURCE, id: 'rcte/guia/1' }, /precisa começar com "efd-icms-ipi\/"/],
    [{ ...GUIA_SOURCE, format: 'htm', page_ranges: ['1-10'] }, /só para PDF\/XLSX/],
    [{ ...GUIA_SOURCE, page_ranges: ['10-1'] }, /início ≤ fim/],
    [{ ...GUIA_SOURCE, enabled: false }, /disabled_reason: obrigatório/],
    [{ ...GUIA_SOURCE, mode: 'ws-tabela' }, /ws_table_id: obrigatório/],
  ])('recusa fonte inválida %#', (source, message) => {
    expect(problems([guiaDocument([source])])).toMatch(message)
  })

  it('aceita fonte desabilitada em http, sem sha256, com o motivo', () => {
    const config = buildCorpusConfig(
      {
        version: 1,
        documents: [
          guiaDocument([
            GUIA_SOURCE,
            {
              ...GUIA_SOURCE,
              id: 'efd-icms-ipi/guia/0',
              version: '0',
              url: 'http://x.gov.br/0',
              sha256: undefined,
              enabled: false,
              disabled_reason: 'só http',
            },
          ]),
        ],
      },
      LEIAUTES,
    )
    expect(config.resolved.map((source) => source.id)).toEqual(['efd-icms-ipi/guia/1'])
  })

  it('recusa id, slug e versão repetidos', () => {
    const twice = [GUIA_SOURCE, { ...GUIA_SOURCE, version: '2' }]
    expect(problems([guiaDocument(twice)])).toMatch(/id repetido/)
    const sameVersion = [GUIA_SOURCE, { ...GUIA_SOURCE, id: 'efd-icms-ipi/guia/2' }]
    expect(problems([guiaDocument(sameVersion)])).toMatch(/versão repetida/)
    expect(
      problems([
        guiaDocument([GUIA_SOURCE]),
        guiaDocument([{ ...GUIA_SOURCE, id: 'efd-icms-ipi/guia/9', version: '9' }]),
      ]),
    ).toMatch(/slug repetido/)
  })

  it('recusa leiaute-periods.yaml inválido', () => {
    const empty = {
      ...LEIAUTES,
      series: {
        'efd-icms-ipi': {
          ...LEIAUTES.series['efd-icms-ipi'],
          periods: [{ code: 'x', from: '2025-01-01', to: '2025-01-01', act: 'a' }],
        },
      },
    }
    expect(problems([guiaDocument([GUIA_SOURCE])], empty)).toMatch(
      /leiaute-periods.yaml: .*período vazio/,
    )
    const duplicate = {
      ...LEIAUTES,
      series: {
        'efd-icms-ipi': {
          ...LEIAUTES.series['efd-icms-ipi'],
          periods: [
            ...LEIAUTES.series['efd-icms-ipi'].periods,
            { code: '019', from: '2030-01-01', to: null, act: 'b' },
          ],
        },
      },
    }
    expect(problems([guiaDocument([GUIA_SOURCE])], duplicate)).toMatch(/código repetido: 019/)
  })

  it('validade publication usa a publicação seguinte; nt sem leiaute conhecido fica sem intervalo', () => {
    const config = buildCorpusConfig(
      {
        version: 1,
        documents: [
          {
            ...guiaDocument([
              { ...GUIA_SOURCE, id: 'efd-go/g/1', leiaute: undefined, published_on: '2024-01-10' },
              {
                ...GUIA_SOURCE,
                id: 'efd-go/g/2',
                version: '2',
                leiaute: undefined,
                published_on: '2024-06-01',
              },
            ]),
            slug: 'go',
            family: 'efd-go',
            parser: 'docling-generic',
            validity: 'publication',
          },
        ],
      },
      LEIAUTES,
    )
    expect(config.resolved.map((source) => source.versionValidDuring)).toEqual([
      { from: '2024-01-10', to: '2024-06-01' },
      { from: '2024-06-01', to: null },
    ])
  })
})
