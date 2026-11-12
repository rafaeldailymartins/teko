import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { WatchPage } from '#app/ports/watch-signals.ts'
import { createWatchSignalReader, parseDottedDate, readHtml } from './signals.ts'

/**
 * Fixtures: recortes mínimos das páginas reais (baixadas em 2026-11-11 com o User-Agent do watch),
 * com os bytes originais (cp1252 nas páginas de Goiás). A extensão `.fixture` as deixa fora do Biome.
 */
function fixture(name: string): Uint8Array {
  return readFileSync(new URL(`./__fixtures__/${name}.fixture`, import.meta.url))
}

const reader = createWatchSignalReader()
const GO = 'https://appasp.economia.go.gov.br/Legislacao/arquivos'

const common = { mode: 'live', encoding: 'windows-1252' } as const

describe('consolidated', () => {
  const page: WatchPage = { ...common, id: 'rcte', family: 'rcte', kind: 'consolidated', url: '' }

  it('lê "CONSOLIDADO ATÉ O DECRETO Nº 10.986, DE 16.09.26" do RCTE', () => {
    const signals = reader.read(page, {
      url: `${GO}/Rcte/RCTE.htm`,
      body: fixture('rcte-cabecalho.htm'),
    })
    expect(signals).toEqual({
      label: 'Decreto nº 10.986',
      labelDate: '2026-09-16',
      labelNumber: 10986,
      items: [],
    })
  })

  it('lê "ATUALIZADO ATÉ A LEI Nº 24.608 DE 06.11.26" do CTE', () => {
    const signals = reader.read(
      { ...page, id: 'cte', family: 'cte' },
      { url: `${GO}/Cte/CTE.htm`, body: fixture('cte-cabecalho.htm') },
    )
    expect(signals).toMatchObject({
      label: 'Lei nº 24.608',
      labelDate: '2026-11-06',
      labelNumber: 24608,
    })
  })

  it('falha quando o cabeçalho sumiu (sinal quebrado)', () => {
    expect(() =>
      reader.read(page, {
        url: 'https://x.gov.br/a',
        body: new TextEncoder().encode('<p>RCTE</p>'),
      }),
    ).toThrow(/CONSOLIDADO ATÉ O DECRETO/)
  })
})

describe('act-list', () => {
  const base = {
    ...common,
    id: 'atos',
    family: 'rcte',
    kind: 'act-list',
    act: 'decreto',
    include: null,
    exclude: null,
    url: '',
  } as const

  it('lista os decretos atualizadores com a data do DOE e o link absoluto', () => {
    const url = `${GO}/Rcte/Decretos_Atualizadores.htm`
    const { items } = reader.read(base, { url, body: fixture('decretos-atualizadores.htm') })
    expect(items.map((item) => [item.key, item.date, item.url])).toEqual([
      ['10986', '2026-09-16', `${GO}/Decretos/D_10986.htm`],
      ['10968', '2026-07-28', `${GO}/Decretos/D_10968.htm`],
      ['10951', '2026-07-08', `${GO}/Decretos/D_10951.htm`],
      ['10948', '2026-07-03', `${GO}/Decretos/D_10948.htm`],
      // link file:/// da rede interna da Sefaz: fica com a âncora da própria página
      ['8460', '2015-09-29', `${url}#ato-8460`],
    ])
    expect(items[0]).toMatchObject({
      versionLabel: 'Decreto nº 10.986',
      fingerprint: '2026-09-16',
      actNumber: 10986,
    })
  })

  it('filtra o sumário do ano pela ementa (include/exclude)', () => {
    const url = `${GO}/INDICES/sumarios/Decretos_2026.htm`
    const page = {
      ...base,
      include: String.raw`^\s*(Altera|Acrescenta|Revoga)\b.{0,400}?Decreto\s+n\S*\s*4\.852`,
      exclude: String.raw`^\s*Altera\s+o\s+Anexo\s+(VIII|IX)\s+do\s+Decreto`,
    }
    const { items } = reader.read(page, { url, body: fixture('sumario-decretos-2026.htm') })
    // 10.991 só cita o RCTE, 10.986 só altera o Anexo IX, 10.973 é do PRODUZIR.
    expect(items.map((item) => [item.key, item.date, item.url])).toEqual([
      ['10968', '2026-07-28', `${GO}/Decretos/D_10968.htm`],
    ])
  })

  it('sem filtro, o sumário traz todos os decretos, com a data do DOE', () => {
    const url = `${GO}/INDICES/sumarios/Decretos_2026.htm`
    const { items } = reader.read(base, { url, body: fixture('sumario-decretos-2026.htm') })
    expect(items.map((item) => [item.key, item.date])).toEqual([
      ['10991', '2026-10-08'],
      ['10986', '2026-09-16'],
      ['10973', '2026-08-12'],
      ['10968', '2026-07-28'],
    ])
  })

  it('lê as leis atualizadoras do CTE; DOE fora do padrão cai na data da lei', () => {
    const url = `${GO}/Cte/leis_atualizadoras.htm`
    const { items } = reader.read(
      { ...base, family: 'cte', act: 'lei' },
      { url, body: fixture('leis-atualizadoras.htm') },
    )
    expect(items.map((item) => [item.versionLabel, item.date, item.url])).toEqual([
      ['Lei nº 11.750', '1992-07-15', `${url}#ato-11750`],
      ['Lei nº 11.870', '1992-12-29', `${url}#ato-11870`],
      ['Lei nº 12.181', '1993-12-03', `${url}#ato-12181`],
    ])
  })

  it('ignora repetições do mesmo ato e data inexistente', () => {
    const html =
      '<p>Decreto nº 1.000, de 31.02.26;</p><p>Decreto nº 1.000, de 01.03.26;</p>' +
      '<p><a href="mailto:x@y">Decreto nº 1.000</a></p>'
    const { items } = reader.read(
      { ...base, encoding: 'utf-8' },
      { url: 'https://x.gov.br/l.htm', body: new TextEncoder().encode(html) },
    )
    expect(items).toEqual([
      {
        key: '1000',
        url: 'https://x.gov.br/l.htm#ato-1000',
        versionLabel: 'Decreto nº 1.000',
        date: null,
        fingerprint: '',
        actNumber: 1000,
      },
    ])
  })
})

describe('document-index', () => {
  it('acha os Guias no JSON embutido do gov.br (com / escapado)', () => {
    const url =
      'https://www.gov.br/sped/pt-br/assuntos/escrituracoes-digitais/efd-icms-ipi/manuais-e-documentos-tecnicos'
    const page: WatchPage = {
      id: 'sped',
      family: 'efd-icms-ipi',
      kind: 'document-index',
      mode: 'live',
      encoding: 'utf-8',
      url,
      documents: [
        {
          pattern: '/manuais-e-documentos-tecnicos/guia-pratico[^/]*$',
          versionPattern: String.raw`(\d+)[-.](\d+)[-.](\d+)`,
        },
      ],
    }
    const { items } = reader.read(page, { url, body: fixture('sped-efd-icms-ipi.html') })
    expect(items.map((item) => item.versionLabel)).toEqual(['3.2.2', '3.2.1', '3.2.3', '3.2.4'])
    expect(items[3]).toEqual({
      key: `${url}/guia-pratico-efd-versao-3-2-4.pdf`,
      url: `${url}/guia-pratico-efd-versao-3-2-4.pdf`,
      versionLabel: '3.2.4',
      date: null,
      fingerprint: '1',
      actNumber: null,
    })
  })

  it('acha os Guias da EFD-GO pelos href e ignora o resto', () => {
    const url = 'https://goias.gov.br/economia/guia-pratico-efd-goias/'
    const page: WatchPage = {
      id: 'go',
      family: 'efd-go',
      kind: 'document-index',
      mode: 'live',
      encoding: 'utf-8',
      url,
      documents: [
        {
          pattern: String.raw`/economia/wp-content/uploads/[^?#]*guia[^/]*\.pdf$`,
          versionPattern: String.raw`(\d+)[._](\d+)`,
        },
      ],
    }
    const { items } = reader.read(page, { url, body: fixture('guia-efd-go.html') })
    expect(items.map((item) => item.versionLabel)).toEqual(['4.2', '4.3', '5.9'])
  })

  it('sem versionPattern o rótulo é nulo; padrão sem grupos usa o trecho casado', () => {
    const html =
      '<a href="docs/leiaute%20v2.zip">a</a><a href="https://x.gov.br/b%E0.pdf">b</a>' +
      '<a href="http://[::1">quebrado</a>'
    const page: WatchPage = {
      id: 'x',
      family: 'efd-reinf',
      kind: 'document-index',
      mode: 'live',
      encoding: 'utf-8',
      url: 'https://x.gov.br/',
      documents: [
        { pattern: String.raw`\.zip$`, versionPattern: String.raw`v\d+` },
        { pattern: String.raw`\.pdf$`, versionPattern: null },
        { pattern: 'nunca', versionPattern: String.raw`(\d+)` },
      ],
    }
    const { items } = reader.read(page, {
      url: 'https://x.gov.br/index',
      body: new TextEncoder().encode(html),
    })
    expect(items.map((item) => [item.url, item.versionLabel])).toEqual([
      ['https://x.gov.br/b%E0.pdf', null],
      ['https://x.gov.br/docs/leiaute%20v2.zip', 'v2'],
    ])
  })

  it('versionPattern que não casa dá rótulo nulo', () => {
    const page: WatchPage = {
      id: 'x',
      family: 'efd-reinf',
      kind: 'document-index',
      mode: 'live',
      encoding: 'utf-8',
      url: 'https://x.gov.br/',
      documents: [{ pattern: String.raw`\.zip$`, versionPattern: String.raw`(\d+)` }],
    }
    const { items } = reader.read(page, {
      url: 'https://x.gov.br/',
      body: new TextEncoder().encode('<a href="/leiaute.zip">x</a>'),
    })
    expect(items[0]?.versionLabel).toBeNull()
  })
})

describe('tables-ws', () => {
  const page: WatchPage = {
    id: 'ws',
    family: 'tabelas-go',
    kind: 'tables-ws',
    mode: 'live',
    encoding: 'utf-8',
    url: '',
    tableIds: [37, 40],
  }
  const url = 'https://www.sped.fazenda.gov.br/spedtabelas/WsConsulta/WsConsulta.asmx/x'

  it('lê versao, dtVersao e hash das tabelas de Goiás', () => {
    const { items } = reader.read(page, { url, body: fixture('ws-tabelas.xml') })
    expect(items).toEqual([
      {
        key: '37',
        url: 'https://www.sped.fazenda.gov.br/spedtabelas/wsconsulta/obterTabela.ashx?idTabela=37&versao=151',
        versionLabel: 'versão 151',
        date: '2026-07-08',
        fingerprint: '151:2F958EA9D7036E4FAD8AAAD2EE0ED1CCBB3CFFA0',
        actNumber: null,
      },
      expect.objectContaining({
        key: '40',
        date: '2024-11-04',
        fingerprint: expect.stringMatching(/^5:/),
      }),
    ])
  })

  it('falha sem metadadosXml (o WS devolve erro como HTML 200)', () => {
    expect(() =>
      reader.read(page, { url, body: new TextEncoder().encode('<html>erro</html>') }),
    ).toThrow(/metadadosXml/)
  })

  it('falha quando falta uma tabela monitorada; sem urlDownloadArquivo usa a URL do WS', () => {
    const xml =
      '<r><metadadosXml>&lt;tabela id="37" versao="1" dtVersao="x" hash="ab" /&gt;' +
      '&lt;tabela id="abc" /&gt;&lt;outra id="40" /&gt;</metadadosXml></r>'
    const body = new TextEncoder().encode(xml)
    expect(() => reader.read(page, { url, body })).toThrow(/tabela 40 ausente/)
    const { items } = reader.read({ ...page, tableIds: [37] }, { url, body })
    expect(items[0]).toMatchObject({
      url: `${url}?idTabela=37&versao=1`,
      date: null,
      fingerprint: '1:AB',
    })
  })
})

describe('auxiliares', () => {
  it('converte datas dd.mm.aa com pivô 70', () => {
    expect(parseDottedDate('16', '9', '26')).toBe('2026-09-16')
    expect(parseDottedDate('29', '12', '97')).toBe('1997-12-29')
    expect(parseDottedDate('1', '1', '1970')).toBe('1970-01-01')
    expect(parseDottedDate('30', '02', '26')).toBeNull()
  })

  it('extrai texto sem script/style e com quebras de bloco', () => {
    const { text, links } = readHtml(
      '<style>p{}</style><p>a<br>b</p><script>x()</script><a href="/c">c&nbsp;d</a><a>sem</a>',
    )
    expect(text).toBe('a b c dsem')
    expect(links).toEqual([{ href: '/c', text: 'c d' }])
  })
})
