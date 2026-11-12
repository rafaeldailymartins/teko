import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { type Family, ReviewStatus } from '#domain/corpus/family.ts'
import type { ParsedProvision, ParsedSource } from '#domain/corpus/parsed-source.ts'
import { parseStableKey } from '#domain/corpus/provision-id.ts'
import { ReviewReason } from '#domain/corpus/validity.ts'
import {
  displayLabelOf,
  goHtmlStateMachineParser,
  headingTailOf,
  parseConsolidatedWithDiagnostics,
  parseLabel,
  readParagraphs,
  sortPathOf,
} from './go-html-state-machine.ts'
import { ParseError, type ParserInput, type SourceDescriptor } from './parser.ts'

/**
 * Fixtures em `__fixtures__/{rcte,cte}`: parágrafos `<p>…</p>` recortados com os bytes cp1252
 * originais dos arquivos oficiais (RCTE.htm "CONSOLIDADO ATÉ O DECRETO Nº 10.986, DE 16.09.26",
 * sha256 e058bc68…; CTE.htm "ATUALIZADO ATÉ A LEI Nº 24.608 DE 06.11.26", sha256 8a8aee52…),
 * baixados em 2026-11-11. Os `.htm.gz` são os Títulos III e IV do RCTE e o Título II do CTE
 * inteiros, para a comparação com a fixture da F2.
 */
const FIXTURES = new URL('./__fixtures__/', import.meta.url)
const F2_DOCUMENTS = new URL('../../../../../../test/fixtures/corpus/documents/', import.meta.url)

function fixture(path: string): Uint8Array {
  const bytes = readFileSync(new URL(path, FIXTURES))
  return new Uint8Array(path.endsWith('.gz') ? gunzipSync(bytes) : bytes)
}

const DOCUMENTS = {
  rcte: {
    slug: 'rcte',
    title: 'Regulamento do Código Tributário do Estado de Goiás (RCTE) - Decreto nº 4.852/1997',
    url: 'https://appasp.economia.go.gov.br/Legislacao/arquivos/Rcte/RCTE.htm',
  },
  cte: {
    slug: 'cte',
    title: 'Código Tributário do Estado de Goiás (CTE) - Lei nº 11.651/1991',
    url: 'https://appasp.economia.go.gov.br/Legislacao/arquivos/Cte/CTE.htm',
  },
} as const

function source(
  family: 'rcte' | 'cte',
  overrides: Partial<SourceDescriptor> = {},
): SourceDescriptor {
  const document = DOCUMENTS[family]
  return {
    id: `${family}/consolidado`,
    family,
    parser: 'go-html-state-machine',
    url: document.url,
    document: {
      slug: document.slug,
      family,
      title: document.title,
      issuer: 'Governo do Estado de Goiás - Secretaria de Estado da Economia',
      sourceUrl: document.url,
    },
    versionLabel: null,
    publishedOn: null,
    versionValidDuring: null,
    effectiveFrom: null,
    optionalFrom: null,
    mandatoryFrom: null,
    yearPivot: null,
    actRef: null,
    ...overrides,
  }
}

function input(
  family: 'rcte' | 'cte',
  bytes: Uint8Array,
  overrides: Partial<SourceDescriptor> = {},
): ParserInput {
  return {
    source: source(family, overrides),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes,
    docling: [],
    members: new Map(),
  }
}

function parse(family: 'rcte' | 'cte', path: string): ParsedSource {
  return goHtmlStateMachineParser(input(family, fixture(path)))
}

function provision(result: ParsedSource, key: string): ParsedProvision {
  const found = result.provisions.find((entry) => entry.stableKey === key)
  if (found === undefined) {
    throw new Error(`dispositivo ausente: ${key}`)
  }
  return found
}

function intervals(result: ParsedSource, key: string): (readonly [string | null, string | null])[] {
  return provision(result, key).versions.map(
    (version) => [version.validDuring.from, version.validDuring.to] as const,
  )
}

describe('readParagraphs', () => {
  it('decodifica cp1252 explicitamente e lê só o texto dos parágrafos', () => {
    const html = Buffer.concat([
      Buffer.from(
        '<html><head><style>p { color: red }</style><title>t</title></head><body>',
        'latin1',
      ),
      Buffer.from('<p class="ParNormal  Outra"><a name=A76P6></a>§ 6', 'latin1'),
      Buffer.from([0xba, 0x20, 0x93]),
      Buffer.from('aspas'),
      Buffer.from([0x94, 0x20, 0x96, 0x20, 0xe7, 0xe3]),
      Buffer.from(
        'o<br>linha&nbsp;nova</p><p class=Vazio> </p><p>sem classe</p><span>fora</span></body></html>',
      ),
    ])
    expect(readParagraphs(new Uint8Array(html))).toEqual([
      { className: 'ParNormal', text: '§ 6º “aspas” – ção linha nova', anchors: ['A76P6'] },
      { className: '', text: 'sem classe', anchors: [] },
    ])
  })
})

describe('parseLabel', () => {
  it.each([
    ['Art. 76. Nas situações especiais', { kind: 'art', value: '76' }],
    ['Art. 1º O imposto', { kind: 'art', value: '1' }],
    ['Art. 56-A. A transferência', { kind: 'art', value: '56-A' }],
    ['Art. 6ºA Texto', { kind: 'art', value: '6-A' }],
    ['Art. 167-G-A. Nas operações', { kind: 'art', value: '167-G-A' }],
    ['Art. 10 A alíquota é', { kind: 'art', value: '10' }],
    ['Parágrafo único. O valor', { kind: 'par', value: 'unico' }],
    ['§ único. Texto', { kind: 'par', value: 'unico' }],
    ['§ 6º Excepcionalmente', { kind: 'par', value: '6' }],
    ['§ 10. A mercadoria', { kind: 'par', value: '10' }],
    ['§ 3º-A. No caso', { kind: 'par', value: '3-A' }],
    ['§ 3º-a. No caso', { kind: 'par', value: '3-A' }],
    ['§ 11 A NF-e emitida', { kind: 'par', value: '11' }],
    ['IV - relativamente', { kind: 'inc', value: 'IV' }],
    ['VIII – a utilização', { kind: 'inc', value: 'VIII' }],
    ['IV-A - de empresa', { kind: 'inc', value: 'IV-A' }],
    ['IV - A empresa', { kind: 'inc', value: 'IV' }],
    ['a) energia elétrica', { kind: 'ali', value: 'a' }],
    ['b-1) texto', { kind: 'ali', value: 'b-1' }],
    ['c-a) texto', { kind: 'ali', value: 'c-1' }],
    ['1. 60 (sessenta) dias', { kind: 'item', value: '1' }],
    ['2-A. para mostruário', { kind: 'item', value: '2-1' }],
    ['10 - veículo', { kind: 'item', value: '10' }],
  ])('%j', (text, expected) => {
    expect(parseLabel(text)).toEqual(expected)
  })

  it.each([
    'LC - texto',
    '2.1. a transmissão da propriedade',
    '1.000,00 reais',
    'O GOVERNADOR DO ESTADO',
    'AICMS INTRA = alíquota',
  ])('não é rótulo: %j', (text) => {
    expect(parseLabel(text)).toBeNull()
  })
})

type LabelSegment = Parameters<typeof sortPathOf>[0][number]
const LABEL_KINDS: ReadonlySet<string> = new Set(['art', 'par', 'inc', 'ali', 'item'])

function labelSegments(key: string): LabelSegment[] {
  return parseStableKey(key).segments.flatMap((segment) =>
    LABEL_KINDS.has(segment.kind)
      ? [{ kind: segment.kind as LabelSegment['kind'], value: segment.value }]
      : [],
  )
}

interface F2Provision {
  readonly stableKey: string
  readonly sortPath: string
  readonly headingPath: string
  readonly versions: readonly {
    readonly displayLabel: string
    readonly validDuring: { from: string; to: string | null }
  }[]
}

function f2(family: 'rcte' | 'cte'): readonly F2Provision[] {
  const document: { readonly provisions: readonly F2Provision[] } = JSON.parse(
    readFileSync(new URL(`${family}.json`, F2_DOCUMENTS), 'utf8'),
  )
  return document.provisions
}

describe('rótulos, sortPath e headingPath no formato da fixture da F2', () => {
  it('aceita o sufixo duplo de artigo ("Art. 167-S-B")', () => {
    const segments: LabelSegment[] = [
      { kind: 'art', value: '167-S-B' },
      { kind: 'par', value: '1-A' },
    ]
    expect(sortPathOf(segments)).toBe('0167SB.p01A')
    expect(displayLabelOf('RCTE', segments)).toBe('RCTE, art. 167-S-B, § 1º-A')
    expect(headingTailOf(segments)).toBe('Art. 167-S-B > § 1º-A')
  })

  it.each(['rcte', 'cte'] as const)(
    'derivam da chave para todos os dispositivos de %s',
    (family) => {
      const prefix = family.toUpperCase()
      for (const entry of f2(family)) {
        const segments = labelSegments(entry.stableKey)
        expect(sortPathOf(segments), entry.stableKey).toBe(entry.sortPath)
        expect(entry.headingPath.endsWith(` > ${headingTailOf(segments)}`), entry.stableKey).toBe(
          true,
        )
        expect(entry.versions.map((version) => version.displayLabel)).toContain(
          displayLabelOf(prefix, segments),
        )
      }
    },
  )
})

describe('golden: RCTE art. 76, §§ 5º a 10 (bytes cp1252 reais)', () => {
  const result = parse('rcte', 'rcte/art-76.htm')

  it('bate com art-76.expected.json', () => {
    const expected: unknown = JSON.parse(
      readFileSync(new URL('rcte/art-76.expected.json', FIXTURES), 'utf8'),
    )
    expect(JSON.parse(JSON.stringify(result))).toEqual(expected)
  })

  it('tem os intervalos exatos da tabela do plano', () => {
    const paragraph6 = provision(result, 'go:rcte:art:76:par:6')
    expect(
      paragraph6.versions.map((version) => [
        version.validDuring,
        version.amendment?.actLabel,
        version.amendment?.changeKind,
      ]),
    ).toEqual([
      [{ from: '2003-09-12', to: '2004-11-04' }, 'Decreto nº 5.825, de 05.09.03', 'acrescimo'],
      [{ from: '2004-11-04', to: '2009-11-23' }, 'Decreto nº 6.026, de 27.10.04', 'nova_redacao'],
      [{ from: '2009-11-23', to: null }, 'Decreto nº 7.028, de 18.11.09', 'revogacao'],
    ])
    for (const key of ['go:rcte:art:76:par:8', 'go:rcte:art:76:par:9']) {
      const current = provision(result, key).versions.at(-1)
      expect(current?.validDuring).toEqual({ from: '2026-07-28', to: null })
      expect(current?.amendment).toMatchObject({
        actLabel: 'Decreto nº 10.968, de 28.07.26',
        changeKind: 'nova_redacao',
      })
    }
  })

  it('marca o retroativo do Dec. 9.716 ("vIGÊNCIA: 01.12.19")', () => {
    const [added] = provision(result, 'go:rcte:art:76:par:8').versions
    expect(added).toMatchObject({
      validDuring: { from: '2019-12-01', to: '2026-07-28' },
      retroactive: true,
      amendment: { actDate: '2020-09-22', effectiveFrom: '2019-12-01' },
    })
  })

  it('filhos herdam a abertura de uma nova redação do § inteiro', () => {
    expect(intervals(result, 'go:rcte:art:76:par:9:inc:I')).toEqual([
      ['2024-04-16', '2026-07-28'],
      ['2026-07-28', null],
    ])
    expect(intervals(result, 'go:rcte:art:76:par:9:inc:II:ali:b')).toEqual([['2026-07-28', null]])
  })

  it('início ilegível na nota ("230.09.03") com abertura no ato próprio: vale o ato', () => {
    const version = provision(result, 'go:rcte:art:76:par:5:inc:I').versions[2]
    expect(version).toMatchObject({
      validDuring: { from: '2003-09-30', to: '2007-08-21' },
      reviewStatus: ReviewStatus.Auto,
      amendment: { actLabel: 'Decreto nº 5.834, de 30.09.03', effectiveFrom: '2003-09-30' },
    })
    expect(result.stats).toEqual({ notesTotal: 14, notesParsed: 14, notesToReview: 0 })
  })

  it('a nota ilegível sem ato próprio vai para revisão com as datas legíveis (sintético)', () => {
    const html = [
      '<p class=TitCentral>CONSOLIDADO ATÉ O DECRETO Nº 10.986, DE 16.09.26.</p>',
      '<p class=ParNormal>Art. 76. Caput.</p>',
      '<p class=NovaRedRev>ACRESCIDO O § 5º AO ART. 76 PELO ART. 2º DO DECRETO Nº 5.707, DE 27.12.02 - vigência: 27.12.02.</p>',
      '<p class=TextoRevo>§ 5º Texto do parágrafo:</p>',
      '<p class=NotaVigncia>NOTA: Redação com vigência de 27.12.02 a 22.11.09.</p>',
      '<p class=TextoRevo>I - texto do inciso;</p>',
      '<p class=NotaVigncia>NOTA: Redação com vigência de 230.09.03 a 20.08.07.</p>',
    ].join('\r\n')
    const result = goHtmlStateMachineParser(
      input('rcte', new Uint8Array(Buffer.from(html, 'latin1'))),
    )
    expect(provision(result, 'go:rcte:art:76:par:5:inc:I').versions).toEqual([
      expect.objectContaining({
        validDuring: { from: '2002-12-27', to: '2007-08-21' },
        reviewStatus: ReviewStatus.Pending,
        review: {
          reason: ReviewReason.NoteDateIllegible,
          rawNote: 'NOTA: Redação com vigência de 230.09.03 a 20.08.07.',
        },
      }),
    ])
    expect(result.stats).toEqual({ notesTotal: 2, notesParsed: 1, notesToReview: 1 })
  })
})

describe('outros casos com recortes reais', () => {
  it('"EXAURIU-SE" fecha o inciso no fim da última redação', () => {
    const result = parse('rcte', 'rcte/exauriu-se.htm')
    const inciso = provision(result, 'go:rcte:art:64:inc:IV')
    expect(
      inciso.versions.map((version) => [version.validDuring, version.reviewStatus, version.text]),
    ).toEqual([
      [
        { from: '2004-11-01', to: '2005-01-01' },
        'auto',
        expect.stringMatching(/^IV - industrializador de mandioca/),
      ],
      [{ from: '2005-01-01', to: null }, 'auto', 'IV - revogado;'],
    ])
    expect(inciso.versions[0]?.amendment).toMatchObject({
      actLabel: 'Decreto nº 6.057, de 30.12.04',
    })
    expect(inciso.versions[0]?.retroactive).toBe(true)
  })

  it('renumeração mantém uma chave e gera labels; "sem vigência" fica no log', () => {
    const result = parse('rcte', 'rcte/renumeracao-sem-vigencia.htm')
    const paragraph = provision(result, 'go:rcte:art:59:par:1')
    expect(paragraph.labels).toEqual([
      { label: 'RCTE, art. 59, parágrafo único', validDuring: { from: null, to: '2011-05-19' } },
      { label: 'RCTE, art. 59, § 1º', validDuring: { from: '2011-05-19', to: null } },
    ])
    expect(paragraph.versions.map((version) => version.validDuring)).toEqual([
      { from: '2011-05-19', to: null },
    ])
    expect(result.provisions.some((entry) => entry.stableKey === 'go:rcte:art:59:par:unico')).toBe(
      false,
    )
    for (const inciso of ['I', 'II', 'III']) {
      const key = `go:rcte:art:59:par:1:inc:${inciso}`
      expect(intervals(result, key)).toEqual([['1998-01-01', null]])
      expect(provision(result, key).versions[0]).toMatchObject({
        reviewStatus: 'auto',
        retroactive: true,
      })
    }
    expect(result.skipped.map((entry) => [entry.stableKey, entry.reason])).toEqual([
      ['go:rcte:art:59:par:1:inc:I', 'sem-vigencia'],
      ['go:rcte:art:59:par:1:inc:II', 'sem-vigencia'],
      ['go:rcte:art:59:par:1:inc:III', 'sem-vigencia'],
    ])
    expect(result.stats).toEqual({ notesTotal: 3, notesParsed: 3, notesToReview: 0 })
  })

  it('estilo incoerente (nota de vigente antes de redação superada) vai para revisão', () => {
    const result = parse('rcte', 'rcte/estilo-trocado.htm')
    expect(provision(result, 'go:rcte:art:12:inc:V').versions).toEqual([
      expect.objectContaining({
        validDuring: { from: '1998-01-01', to: '2001-01-01' },
        reviewStatus: ReviewStatus.Pending,
        review: {
          reason: ReviewReason.StyleMismatch,
          rawNote: expect.stringMatching(/^Conferida nova redação ao INCISO IV do art\. 12/),
        },
      }),
    ])
  })

  it('prorrogação: a nota de alteração declara o fim prorrogado; filhos herdam o acréscimo', () => {
    const result = parse('rcte', 'rcte/prorrogacao.htm')
    const paragraph = provision(result, 'go:rcte:art:76:par:3-A')
    expect(paragraph.versions.map((version) => version.validDuring)).toEqual([
      { from: '2006-07-12', to: '2008-08-01' },
      { from: '2008-08-01', to: null },
    ])
    expect(paragraph.versions[0]?.amendment?.rawNote).toMatch(/PRORROGADA PARA 31\.07\.08/)
    expect(intervals(result, 'go:rcte:art:76:par:3-A:inc:I')).toEqual([['2006-07-12', null]])
  })

  it('CTE de 1995: pivô 91 e redações anteriores à reestruturação de 1997 em revisão', () => {
    const result = parse('cte', 'cte/art-71-pivo-91.htm')
    expect(result.version).toMatchObject({
      versionLabel: 'CTE atualizado até a Lei nº 24.608, de 06.11.26',
      publishedOn: '2026-11-06',
      consolidatedUntil: 'Lei nº 24.608, de 06.11.26',
      actRef: 'Lei nº 11.651, de 26.12.91',
    })
    for (const key of [
      'go:cte:art:71:inc:IV',
      'go:cte:art:71:inc:IV:ali:a',
      'go:cte:art:71:inc:IV:ali:b',
    ]) {
      expect(provision(result, key).versions).toEqual([
        expect.objectContaining({
          validDuring: { from: '1992-07-15', to: '1996-01-01' },
          reviewStatus: ReviewStatus.Pending,
          review: expect.objectContaining({ reason: ReviewReason.BeforeRestructuring }),
        }),
      ])
    }
    expect(provision(result, 'go:cte:art:71').headingPath).toMatch(
      /^CTE > TÍTULO II - DO IMPOSTO SOBRE OPERAÇÕES/,
    )
  })
})

describe('erros e descritor', () => {
  it('recusa família que não é consolidado de Goiás', () => {
    const base = input('rcte', fixture('rcte/exauriu-se.htm'))
    const efd: Family = 'efd-icms-ipi'
    expect(() =>
      goHtmlStateMachineParser({ ...base, source: { ...base.source, family: efd } }),
    ).toThrow(ParseError)
  })

  it('sem o cabeçalho, usa a data e o rótulo do descritor ou falha', () => {
    const bytes = new Uint8Array(Buffer.from('<p class=ParNormal>Art. 1º Texto.</p>', 'latin1'))
    expect(() => goHtmlStateMachineParser(input('rcte', bytes))).toThrow(/cabeçalho/)
    const result = goHtmlStateMachineParser(
      input('rcte', bytes, {
        publishedOn: '2026-01-01',
        versionLabel: 'RCTE de teste',
        effectiveFrom: '1998-02-01',
      }),
    )
    expect(result.version).toMatchObject({ versionLabel: 'RCTE de teste', consolidatedUntil: null })
    expect(intervals(result, 'go:rcte:art:1')).toEqual([['1998-02-01', null]])
  })

  it('o CTE fora do recorte (sem "TÍTULO II") não gera dispositivos', () => {
    const bytes = new Uint8Array(
      Buffer.from(
        '<p class=TitCentral>ATUALIZADO ATÉ A LEI Nº 1 DE 01.01.20</p><p class=ParNormal>Art. 1º X.</p>',
        'latin1',
      ),
    )
    expect(goHtmlStateMachineParser(input('cte', bytes)).provisions).toEqual([])
  })
})

describe('comparação com a fixture da F2 (recortes inteiros)', () => {
  /** Chaves citadas pelo golden das evals: têm de sair idênticas. */
  const GOLDEN_KEYS = {
    rcte: [
      'go:rcte:art:71:par:unico',
      'go:rcte:art:71:inc:I',
      'go:rcte:art:76:par:5:inc:I',
      'go:rcte:art:76:par:6',
      'go:rcte:art:76:par:8',
      'go:rcte:art:76:par:9',
    ],
    cte: ['go:cte:art:52'],
  } as const

  const CASES = [
    { family: 'rcte', path: 'rcte/titulos-iii-e-iv.htm.gz', minMatched: 720, minNotes: 0.92 },
    { family: 'cte', path: 'cte/titulo-ii.htm.gz', minMatched: 275, minNotes: 0.92 },
  ] as const

  it.each(CASES)(
    '$family: notas, golden e versões da fixture',
    ({ family, path, minMatched, minNotes }) => {
      const { source: result, diagnostics } = parseConsolidatedWithDiagnostics(
        input(family, fixture(path)),
      )
      const { validityNotes } = diagnostics
      expect(validityNotes.parsed + validityNotes.toReview).toBe(validityNotes.total)
      expect(validityNotes.parsed / validityNotes.total).toBeGreaterThanOrEqual(minNotes)
      expect(result.stats.notesParsed + result.stats.notesToReview).toBe(result.stats.notesTotal)

      const reference = f2(family)
      for (const key of GOLDEN_KEYS[family]) {
        const expected = reference.find((entry) => entry.stableKey === key)
        const parsed = provision(result, key)
        expect(parsed.headingPath, key).toBe(expected?.headingPath)
        expect(
          parsed.versions
            .filter((version) => version.reviewStatus === 'auto')
            .map((version) => version.validDuring),
          key,
        ).toEqual(expected?.versions.map((version) => version.validDuring))
      }

      let matched = 0
      for (const entry of reference) {
        const parsed = result.provisions.find(
          (candidate) => candidate.stableKey === entry.stableKey,
        )
        for (const version of entry.versions) {
          if (
            parsed?.versions.some(
              (candidate) =>
                candidate.validDuring.from === version.validDuring.from &&
                candidate.validDuring.to === version.validDuring.to,
            )
          ) {
            matched += 1
          }
        }
      }
      expect(matched).toBeGreaterThanOrEqual(minMatched)
    },
  )
})
