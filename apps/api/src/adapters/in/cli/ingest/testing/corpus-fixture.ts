import { createHash } from 'node:crypto'
import type { SafeFetcher, SafeFetchResponse } from '#app/ports/safe-fetcher.ts'
import { buildCorpusConfig, type CorpusConfig } from '../sources.ts'
import { buildZip } from './zip-builder.ts'

/**
 * Corpus mínimo para os testes do `discover` e do `load`: um Guia em PDF dividido em duas partes,
 * duas versões do Guia EFD-GO (fora de ordem no arquivo), o RCTE ao vivo, uma tabela do WS e um
 * pacote de XSD da REINF. Os bytes são sintéticos; os sha256 são calculados aqui.
 */

export const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
export const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')

export const GUIA_PDF = encode('%PDF-1.7 guia 3.2.4')
const GO_59_PDF = encode('%PDF-1.7 guia goias 5.9')
export const GO_58_PDF = encode('%PDF-1.7 guia goias 5.8')
const RCTE_HTML = encode('<html>RCTE consolidado</html>')
export const TABLE_TXT = encode(
  'versão=5 TIPO_UTIL, DESC, DT_INI, DT_FIM\r\nGO01|Desc|01012009|\r\n',
)
const REINF_ZIP = buildZip([
  { name: '20240930/R-2010-evtTomadorServicos-v2_01_02d.xsd', data: '<xs:schema/>' },
])

export const URLS = {
  guia: 'https://www.gov.br/sped/guia-3-2-4.pdf/@@download/file',
  go59: 'https://goias.gov.br/economia/Guia_pratico_5.9.pdf',
  go58: 'https://goias.gov.br/economia/Guia_pratico_5.8.pdf',
  rcte: 'https://appasp.economia.go.gov.br/Legislacao/arquivos/Rcte/RCTE.htm',
  reinf: 'https://www.gov.br/sped/reinf/xsd-eventos/@@download/file',
  wsVersions:
    'https://www.sped.fazenda.gov.br/spedtabelas/WsConsulta/WsConsulta.asmx/consultarVersoesTabelasExternas?codigoSistema=SpedFiscal',
  table40:
    'https://www.sped.fazenda.gov.br/spedtabelas/WsConsulta/obterTabela.ashx?idTabela=40&versao=5',
} as const

const WS_VERSIONS_XML = `<?xml version="1.0"?><R><codigoRetorno>101</codigoRetorno><metadadosXml>&lt;tabelas&gt;&lt;tabela id="40" desc="5.5- Tabela" versao="5" dtVersao="2024-11-04" hash="C73DE89E26DBF1A081B86D0B76819AF0131392C9" /&gt;&lt;/tabelas&gt;</metadadosXml></R>`

const doc = (fields: Record<string, unknown>) => ({
  issuer: 'Emissor',
  source_url: 'https://www.gov.br/sped',
  ...fields,
})

export function testCorpusConfig(
  overrides: { guiaSha256?: string; guiaUrl?: string } = {},
): CorpusConfig {
  return buildCorpusConfig(
    {
      version: 1,
      documents: [
        doc({
          slug: 'guia-pratico-efd-icms-ipi',
          family: 'efd-icms-ipi',
          title: 'Guia Prático',
          parser: 'docling-guia',
          validity: 'leiaute',
          act_ref: 'Ato COTEPE/ICMS nº 44/2018',
          sources: [
            {
              id: 'efd-icms-ipi/guia-pratico/3.2.4',
              version: '3.2.4',
              version_label: 'Guia 3.2.4',
              url: overrides.guiaUrl ?? URLS.guia,
              mode: 'pinned',
              sha256: overrides.guiaSha256 ?? sha256(GUIA_PDF),
              format: 'pdf',
              published_on: '2026-07-30',
              leiaute: '020',
              page_ranges: ['1-2', '3-4'],
              timeout_seconds: 7200,
            },
          ],
        }),
        doc({
          slug: 'guia-pratico-efd-goias',
          family: 'efd-go',
          title: 'Guia EFD-GO',
          parser: 'docling-generic',
          validity: 'publication',
          sources: [
            {
              id: 'efd-go/guia-pratico/5.9',
              version: '5.9',
              version_label: 'Guia GO 5.9',
              url: URLS.go59,
              mode: 'pinned',
              sha256: sha256(GO_59_PDF),
              format: 'pdf',
              published_on: '2026-03-16',
            },
            {
              id: 'efd-go/guia-pratico/5.8',
              version: '5.8',
              version_label: 'Guia GO 5.8',
              url: URLS.go58,
              mode: 'pinned',
              sha256: sha256(GO_58_PDF),
              format: 'pdf',
              published_on: '2025-10-02',
              ocr: true,
            },
          ],
        }),
        doc({
          slug: 'rcte',
          family: 'rcte',
          title: 'RCTE',
          source_url: URLS.rcte,
          parser: 'go-html-state-machine',
          validity: 'consolidated',
          sources: [
            { id: 'rcte/consolidado', url: URLS.rcte, mode: 'live', format: 'htm', year_pivot: 97 },
          ],
        }),
        doc({
          slug: 'tabela-go-5-5',
          family: 'tabelas-go',
          title: 'Tabela 5.5',
          parser: 'sped-tabelas',
          validity: 'table',
          sources: [
            {
              id: 'tabelas-go/5-5',
              url: 'https://www.sped.fazenda.gov.br/spedtabelas/WsConsulta/obterTabela.ashx?idTabela=40',
              mode: 'ws-tabela',
              ws_table_id: 40,
              format: 'txt',
            },
          ],
        }),
        doc({
          slug: 'leiautes-efd-reinf',
          family: 'efd-reinf',
          title: 'Leiautes REINF',
          parser: 'reinf-xsd',
          validity: 'leiaute',
          sources: [
            {
              id: 'efd-reinf/leiautes/2.1.2',
              version: '2.1.2d',
              version_label: 'REINF 2.1.2',
              url: URLS.reinf,
              mode: 'pinned',
              sha256: sha256(REINF_ZIP),
              format: 'zip',
              published_on: '2023-03-16',
              leiaute: '2.1.2',
            },
          ],
        }),
      ],
    },
    {
      version: 1,
      series: {
        'efd-icms-ipi': {
          title: 'Leiautes',
          source_url: 'https://www.confaz.fazenda.gov.br/x',
          periods: [{ code: '020', from: '2026-01-01', to: null, act: 'Ato' }],
        },
        'efd-reinf': {
          title: 'REINF',
          source_url: 'https://www.gov.br/sped/reinf',
          periods: [{ code: '2.1.2', from: '2023-09-01', to: null, act: 'ADE 23/2023' }],
        },
      },
    },
  )
}

function okResponse(url: string, body: Uint8Array): SafeFetchResponse {
  return { status: 200, url, headers: {}, body }
}

export const DEFAULT_RESPONSES: Readonly<Record<string, Uint8Array>> = {
  [URLS.guia]: GUIA_PDF,
  [URLS.go59]: GO_59_PDF,
  [URLS.go58]: GO_58_PDF,
  [URLS.rcte]: RCTE_HTML,
  [URLS.reinf]: REINF_ZIP,
  [URLS.wsVersions]: encode(WS_VERSIONS_XML),
  [URLS.table40]: TABLE_TXT,
}

/** `SafeFetcher` falso: responde pelo mapa (URL desconhecida = 404) e registra as URLs pedidas. */
export function fakeFetcher(
  responses: Readonly<Record<string, Uint8Array | SafeFetchResponse>> = DEFAULT_RESPONSES,
): SafeFetcher & { readonly urls: string[] } {
  const urls: string[] = []
  return {
    urls,
    fetch: (request) => {
      urls.push(request.url)
      const entry = responses[request.url]
      if (entry === undefined) {
        return Promise.resolve({
          status: 404,
          url: request.url,
          headers: {},
          body: new Uint8Array(),
        })
      }
      return Promise.resolve(entry instanceof Uint8Array ? okResponse(request.url, entry) : entry)
    },
  }
}
