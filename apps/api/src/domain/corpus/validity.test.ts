import { fc, test } from '@fast-check/vitest'
import {
  addDays,
  containsDate,
  fromEpochDay,
  type IsoDate,
  isDateCovered,
  overlaps,
  toEpochDay,
  type ValidityInterval,
} from '@teko/shared/vigencia'
import { describe, expect, it } from 'vitest'
import { ChangeKind } from './family.ts'
import {
  applyRestructuringCut,
  expandTwoDigitYear,
  extractInlineNote,
  flagOverlaps,
  foldNote,
  inclusiveToHalfOpen,
  isRetroactive,
  mergeIdenticalConsecutive,
  parseActReference,
  parseAmendmentNote,
  parseNoteDate,
  parseValidityNote,
  parseWithoutEffectNote,
  ReviewReason,
  resolveTimeline,
  SkipReason,
  type TimedText,
  type VersionCandidate,
} from './validity.ts'

const RCTE = 97
const CTE = 91

describe('datas das notas', () => {
  it('resolve o ano de 2 dígitos pelo pivô do documento', () => {
    expect(expandTwoDigitYear(97, RCTE)).toBe(1997)
    expect(expandTwoDigitYear(96, RCTE)).toBe(2096)
    expect(expandTwoDigitYear(26, RCTE)).toBe(2026)
    expect(expandTwoDigitYear(95, CTE)).toBe(1995)
    expect(expandTwoDigitYear(91, CTE)).toBe(1991)
    expect(expandTwoDigitYear(90, CTE)).toBe(2090)
  })

  it('lê dd.mm.aa e dd.mm.aaaa e recusa datas inexistentes', () => {
    expect(parseNoteDate('17.12.98', RCTE)).toBe('1998-12-17')
    expect(parseNoteDate(' 1.1.98 ', RCTE)).toBe('1998-01-01')
    expect(parseNoteDate('17.12.1998', RCTE)).toBe('1998-12-17')
    expect(parseNoteDate('31.12.95', CTE)).toBe('1995-12-31')
    expect(parseNoteDate('230.09.03', RCTE)).toBeNull()
    expect(parseNoteDate('31.02.04', RCTE)).toBeNull()
    expect(parseNoteDate('01.01.199', RCTE)).toBeNull()
    expect(parseNoteDate('vigência', RCTE)).toBeNull()
  })

  it('converte o período inclusivo da fonte em meio-aberto', () => {
    expect(inclusiveToHalfOpen('2003-09-12', '2004-11-03')).toEqual({
      from: '2003-09-12',
      to: '2004-11-04',
    })
    expect(inclusiveToHalfOpen('2026-07-28', null)).toEqual({ from: '2026-07-28', to: null })
    expect(inclusiveToHalfOpen('2003-09-12', '2003-09-12')).toEqual({
      from: '2003-09-12',
      to: '2003-09-13',
    })
    expect(inclusiveToHalfOpen('2023-05-01', '2023-04-30')).toBeNull()
  })

  it('marca efeito retroativo quando o efeito é anterior ao ato', () => {
    expect(isRetroactive('2019-12-01', '2020-09-22')).toBe(true)
    expect(isRetroactive('2026-07-28', '2026-07-28')).toBe(false)
    expect(isRetroactive('2026-07-28', null)).toBe(false)
  })

  it('dobra acentos, caixa e travessões', () => {
    expect(foldNote('  vIGÊNCIA –  01.12.19 ')).toBe('vigencia - 01.12.19')
  })
})

describe('parseValidityNote (NotaVigncia)', () => {
  it.each([
    ['NOTA: Redação com vigência de 12.09.03 a 03.11.04.', '2003-09-12', '2004-11-03'],
    ['Nota: Redação com vigência de 16.04.24 A 27.07.26', '2024-04-16', '2026-07-27'],
    ['Nota: Redação com vigência de 01.01.98 à 31.12.00', '1998-01-01', '2000-12-31'],
    ['1. Redação com vigência de 17.12.98 a 30.09.08.', '1998-12-17', '2008-09-30'],
    ['1Redação com vigência de 01.01.98 a 31.12.05.', '1998-01-01', '2005-12-31'],
    ['NOTA: Redação com vigêcia de 01.01.98 a 31.12.00', '1998-01-01', '2000-12-31'],
    ['Nota: Redação com vigência de 08.06.04a 09.06.09.', '2004-06-08', '2009-06-09'],
    ['NOTA: Redação com vigência 01.03.92 a 31.12.95.', '1992-03-01', '1995-12-31'],
  ])('lê %j', (raw, first, last) => {
    const pivot = raw.includes('92') ? CTE : RCTE
    expect(parseValidityNote(raw, pivot)).toEqual({
      kind: 'interval',
      first,
      last,
      extended: false,
    })
  })

  it('aplica a prorrogação ao fim', () => {
    expect(
      parseValidityNote(
        'Redação com vigência de 12.07.06 a 31.07.07 (VIGÊNCIA ORIGINAL PRORROGADA PARA 31.07.08)',
        RCTE,
      ),
    ).toEqual({ kind: 'interval', first: '2006-07-12', last: '2008-07-31', extended: true })
  })

  it('reconhece "sem vigência" com a data da retroação', () => {
    expect(
      parseValidityNote(
        'NOTA: Redação sem - vigência em função da alteração retroagir a 01.01.98.',
        RCTE,
      ),
    ).toEqual({ kind: 'without-validity', retroactsTo: '1998-01-01' })
    expect(parseValidityNote('Nota: Redação sem vigência.', RCTE)).toEqual({
      kind: 'without-validity',
      retroactsTo: null,
    })
  })

  it('lê a nota de início ("a partir de")', () => {
    expect(parseValidityNote('NOTA: Redação com vigência a partir de 16.09.96.', CTE)).toEqual({
      kind: 'start',
      first: '1996-09-16',
    })
    expect(
      parseValidityNote('NOTA: Redação com vigência a partir de 31.02.96.', CTE),
    ).toMatchObject({
      kind: 'unparsed',
      reason: ReviewReason.NoteDateIllegible,
    })
  })

  it('manda para revisão o que não dá para converter com segurança', () => {
    expect(parseValidityNote('NOTA: Redação com vigência de 230.09.03 a 20.08.07.', RCTE)).toEqual({
      kind: 'unparsed',
      reason: ReviewReason.NoteDateIllegible,
      first: null,
      last: '2007-08-20',
    })
    expect(
      parseValidityNote('NOTA: Redação com vigência de 20.03.07 a 31.010.07', RCTE),
    ).toMatchObject({ kind: 'unparsed', reason: ReviewReason.NoteUnparsed })
    expect(
      parseValidityNote(
        'NOTA: Redação com vigência de 01.01.98 a 31.08.01(energia elétrica) e 30.09.01(serviço de telecomunicação);',
        RCTE,
      ),
    ).toMatchObject({ kind: 'unparsed', reason: ReviewReason.NoteAmbiguous })
    expect(
      parseValidityNote('NOTA: Redação sem com vigência de 01.01.01 a 22.08.06.', RCTE),
    ).toEqual({
      kind: 'unparsed',
      reason: ReviewReason.NoteAmbiguous,
      first: '2001-01-01',
      last: '2006-08-22',
    })
    expect(
      parseValidityNote('Nota: Redação com vigência de 01.01.98 e 31.12.00', RCTE),
    ).toMatchObject({
      kind: 'unparsed',
      reason: ReviewReason.NoteAmbiguous,
    })
  })

  it('ignora o que não é nota de vigência', () => {
    expect(parseValidityNote('NOTAS:', RCTE)).toEqual({ kind: 'not-validity' })
    expect(
      parseValidityNote('NOTA: A exclusão dos semi-elaborados vigorou até 31.12.96.', CTE),
    ).toEqual({ kind: 'not-validity' })
    expect(
      parseValidityNote(
        '2. O art. 3º do Decreto nº 5.002, de 29.01.99, permite a utilização do formulário até 31.03.99.',
        RCTE,
      ),
    ).toEqual({ kind: 'not-validity' })
  })
})

describe('parseWithoutEffectNote ("Redação … sem efeitos a partir de …")', () => {
  // Textos literais do RCTE.htm e do CTE.htm (2026-11-13), depois da decodificação cp1252.
  it('lê "a partir de" com data por extenso (NOTA:, sem espaço, e a alíquota de 14,17% depois)', () => {
    expect(
      parseWithoutEffectNote(
        'NOTA:Redação do inciso VIII sem efeitos a partir de 23 de junho de 2022 em função da Lei Complementar Federal nº 194, de 2022, sendo que, a partir de 15 de julho de 2022, é aplicada a alíquota de 14,17% (quatorze inteiros e dezessete décimos por cento) em função',
        RCTE,
      ),
    ).toEqual({ label: 'inciso viii', from: '2022-06-23', until: null })
  })

  it('lê a nota numerada com o rótulo entre aspas curvas (alínea e item)', () => {
    expect(
      parseWithoutEffectNote(
        '1.Redação da alínea “a” sem efeitos a partir de 23 de junho de 2022 em função da Lei Complementar Federal nº 194, de 23 de junho de 2022.',
        RCTE,
      ),
    ).toEqual({ label: 'alinea a', from: '2022-06-23', until: null })
    expect(
      parseWithoutEffectNote(
        '1.Redação do item 1 sem efeitos a partir de 23 de junho de 2022 em função da Lei Complementar Federal nº 194, de 2022;',
        CTE,
      ),
    ).toEqual({ label: 'item 1', from: '2022-06-23', until: null })
    expect(
      parseWithoutEffectNote(
        '1. Redação do inciso XII sem efeitos a partir de 23 de junho de 2022 em função da Lei Complementar Federal nº 194, de 2022.',
        CTE,
      ),
    ).toEqual({ label: 'inciso xii', from: '2022-06-23', until: null })
  })

  it('lê o período fechado "de a a b" com datas numéricas', () => {
    expect(
      parseWithoutEffectNote(
        '1. Redação do inciso IX sem efeitos de 23.06.22 a 29.04.23 em função da Lei Complementar Federal nº 194, de 2022.',
        RCTE,
      ),
    ).toEqual({ label: 'inciso ix', from: '2022-06-23', until: '2023-04-29' })
  })

  it('aceita "desde", "sem efeito" no singular e o dia "1º"', () => {
    expect(
      parseWithoutEffectNote('Nota: Redação do § 2º sem efeito desde 1º de janeiro de 2024.', RCTE),
    ).toEqual({ label: '§ 2º', from: '2024-01-01', until: null })
    expect(
      parseWithoutEffectNote('Redação da alínea "b" sem efeitos a partir de 01.07.23', RCTE),
    ).toEqual({ label: 'alinea b', from: '2023-07-01', until: null })
  })

  it('data ilegível ou período invertido voltam sem data (vão para revisão)', () => {
    expect(
      parseWithoutEffectNote(
        'NOTA: Redação do inciso VIII sem efeitos a partir de 31 de junhoo de 2022.',
        RCTE,
      ),
    ).toEqual({ label: 'inciso viii', from: null, until: null })
    expect(
      parseWithoutEffectNote('Redação do inciso IX sem efeitos de 29.04.23 a 23.06.22.', RCTE),
    ).toEqual({ label: 'inciso ix', from: null, until: null })
    for (const text of [
      'Redação do inciso IX sem efeitos em função da LC 194.',
      'Redação do inciso IX sem efeitos desde a publicação da LC 194.',
      'Redação do inciso IX sem efeitos de 23.06.22 em função da LC 194.',
      'Redação do inciso IX sem efeitos de 23.06.22 a partir da LC 194.',
    ]) {
      expect(parseWithoutEffectNote(text, RCTE), text).toEqual({
        label: 'inciso ix',
        from: null,
        until: null,
      })
    }
  })

  it('não confunde com texto de lei, revogação, nota de vigência nem "sem aplicabilidade"', () => {
    for (const text of [
      'II - recebida sem efeito suspensivo (Convênio ICMS 73/91, cláusula quarta);',
      '§ 7º O reconhecimento da isenção do IPVA feito por meio de ato declaratório torna-se sem efeito na hipótese de ser constatado',
      'Redação revogada a partir de 01.01.16 pela Lei nº 19.021',
      'NOTA: Redação sem - vigência em função da alteração retroagir seus efeitos a 01.04.05.',
      '2. Redação com vigência de 01.01.16 a 31.05.23 .',
      'Nota: A alínea "b" do inciso II do § 1º do art. 4º encontrava-se sem aplicabilidade, até a entrada em vigor de Lei Complementar 190/2022',
      '2.Alínea “a” declarada inconstitucional, a partir de 1º de janeiro de 2024, pela decisão do Supremo Tribunal Federal',
    ]) {
      expect(parseWithoutEffectNote(text, RCTE)).toBeNull()
    }
  })
})

describe('parseActReference', () => {
  it('monta o rótulo do ato no formato da fixture', () => {
    expect(
      parseActReference('PELO ART. 1º DO DECRETO Nº 6.026, DE 27.10.04 - vigência', RCTE),
    ).toEqual({ label: 'Decreto nº 6.026, de 27.10.04', kind: 'decreto', date: '2004-10-27' })
    expect(parseActReference('PELO ART. 2º DO DECRETO Nº 6.057/04, DE 30.12.04', RCTE)).toEqual({
      label: 'Decreto nº 6.057, de 30.12.04',
      kind: 'decreto',
      date: '2004-12-30',
    })
    expect(parseActReference('PELO ART. 1º DA LEI Nº 12.806 DE 27.12.95 - vigência', CTE)).toEqual({
      label: 'Lei nº 12.806, de 27.12.95',
      kind: 'lei',
      date: '1995-12-27',
    })
    expect(
      parseActReference('(Redação acrescida pelo Decreto nº 8.068 - vigência: 30.12.13)', RCTE),
    ).toEqual({ label: 'Decreto nº 8.068', kind: 'decreto', date: null })
    expect(parseActReference('pela Lei Complementar nº 87, de 13.09.96', CTE)).toMatchObject({
      kind: 'lei-complementar',
      label: 'Lei Complementar nº 87, de 13.09.96',
    })
    expect(parseActReference('pelo Convênio ICMS 77/07', RCTE)).toMatchObject({ kind: 'convenio' })
    expect(parseActReference('O INCISO IV EXAURIU-SE', RCTE)).toBeNull()
  })
})

describe('parseAmendmentNote (NovaRedao/NovaRedRev)', () => {
  it('lê ato, data de efeito e tipo de alteração', () => {
    const note = parseAmendmentNote(
      'CONFERIDA NOVA REDAÇÃO AO § 6º DO ART 76 PELO ART. 1º DO DECRETO Nº 6.026, DE 27.10.04 - vigência: 04.11.04.',
      RCTE,
    )
    expect(note).toMatchObject({
      changeKind: ChangeKind.NovaRedacao,
      act: { label: 'Decreto nº 6.026, de 27.10.04', date: '2004-10-27' },
      effectiveFrom: '2004-11-04',
      until: null,
      exhausted: false,
      caputOnly: false,
      renumberedFrom: null,
    })
  })

  it.each([
    [
      'ACRESCIDO O § 8º AO ART. 76 PELO ART. 1º DO dECRETO Nº 9.716, DE 22.09.20 - vIGÊNCIA: 01.12.19',
      ChangeKind.Acrescimo,
      '2019-12-01',
    ],
    [
      'REVOGADO O § 6º DO ART. 76 PELO ART. 2º DO DECRETO Nº 7.028, DE 18.11.09 - vigência: 23.11.09.',
      ChangeKind.Revogacao,
      '2009-11-23',
    ],
    [
      'ACRESCIDO O § 9º AO ART. 76, PELO ART. 1º DO DECRETO Nº 10.636, DE 03.02.25 – VIGÊNCIA: 16.04.24',
      ChangeKind.Acrescimo,
      '2024-04-16',
    ],
    [
      'revogada, TACITAMENTE, a expressão pelo art. 3º da lei nº 14.634, de 29.12.03 - vigência: 29.12.03.',
      ChangeKind.Revogacao,
      '2003-12-29',
    ],
    [
      'REVIGORADO O INCISO II PELO DECRETO Nº 5.000, DE 01.01.99 - vigência: 01.01.99.',
      ChangeKind.NovaRedacao,
      '1999-01-01',
    ],
    [
      'PRORROGADO O PRAZO PELO DECRETO Nº 5.000, DE 01.01.99 - vigência: 01.01.99.',
      ChangeKind.Prorrogacao,
      '1999-01-01',
    ],
    [
      'POR FORÇA DO ART. 2º DO DECRETO Nº 7.344, DE 18.05.11, Com vigência A PARTIR DE 19.05.11, FICA RENUMERADO O PARÁGRAFO ÚNICO PARA § 1º.',
      ChangeKind.Renumeracao,
      '2011-05-19',
    ],
    ['SEM TIPO NEM DATA', null, null],
  ])('%s', (raw, changeKind, effectiveFrom) => {
    expect(parseAmendmentNote(raw, RCTE)).toMatchObject({ changeKind, effectiveFrom })
  })

  it('lê o fim declarado e a prorrogação do § 3º-A do art. 76', () => {
    expect(
      parseAmendmentNote(
        'ACRESCIDO O INCISO IV AO § 2º dO ART. 76 PELO ART. 2º DO DECRETO Nº 6.551, DE 28.09.06 - vigência: 12.07.06 A 31.07.07.',
        RCTE,
      ),
    ).toMatchObject({ effectiveFrom: '2006-07-12', until: '2007-07-31' })
    expect(
      parseAmendmentNote(
        'ACRESCIDO O § 3º-a AO ART. 76 PELO ART. 2º DO DECRETO Nº 6.551, DE 28.09.06 - vigência: 12.07.06 A 31.07.07 (VIGÊNCIA ORIGINAL PRORROGADA PARA 31.07.08 PELO cONVÊNIO ICMS 77/07);',
        RCTE,
      ),
    ).toMatchObject({ effectiveFrom: '2006-07-12', until: '2008-07-31' })
  })

  it('reconhece "EXAURIU-SE", "nova redação ao caput" e renumerações', () => {
    expect(
      parseAmendmentNote(
        'O INCISO IV do ART. 64, EXAURIU-SE EM FUNÇÃO DO DECURSO DO PRAZO DE - vigência.',
        RCTE,
      ),
    ).toMatchObject({ exhausted: true, effectiveFrom: null, changeKind: ChangeKind.Revogacao })
    expect(
      parseAmendmentNote(
        'CONFERIDA NOVA REDAÇÃO AO CAPUT DO § 3º DO ART 76 PELO ART. 1º DO DECRETO Nº 10.968, DE 28.07.26 - vigência: 28.07.26.',
        RCTE,
      ).caputOnly,
    ).toBe(true)
    const renumbered = parseAmendmentNote(
      'RENUMERADO O PARÁGRAFO ÚNICO DO ART. 76 PARA § 1º PELO ART. 9º DO DECRETO Nº 5.002, DE 29.01.99 - vigência: 17.12.98.',
      RCTE,
    )
    expect(renumbered).toMatchObject({
      changeKind: ChangeKind.Renumeracao,
      renumberedFrom: 'paragrafo unico',
      effectiveFrom: '1998-12-17',
    })
    expect(
      parseAmendmentNote(
        'O § 1º VIGOROU COMO PARÁGRAFO ÚNICO ATÉ 04.04.22, QUANDO FOI RENUMERADO PELO ART. 5º do Decreto nº 10.611, de 18.12.24',
        RCTE,
      ),
    ).toMatchObject({ renumberedFrom: 'paragrafo unico', effectiveFrom: '2022-04-05' })
    expect(
      parseAmendmentNote(
        'FICA RENUMERADO O INCISO XVI PARA INCISO XVIII DO ART. 19, COM NOVA REDAÇÃO CONFERIDA PELO ART. 1º DA LEI Nº 22.285, DE 26.09.23 - vigência: 01.05.23.',
        CTE,
      ),
    ).toMatchObject({ renumberedFrom: 'inciso xvi', changeKind: ChangeKind.NovaRedacao })
    expect(
      parseAmendmentNote(
        'RENUMERADO PARA § 1º O PARÁGRAFO ÚNICO O ART. 248-H PELO DECRETO Nº 9.716, DE 22.09.20 - vIGÊNCIA: 01.12.19',
        RCTE,
      ).renumberedFrom,
    ).toBe('paragrafo unico')
  })
})

describe('extractInlineNote', () => {
  it('separa a nota inline do texto', () => {
    const { text, note } = extractInlineNote(
      'b) não contribuinte; (Redação acrescida pelo Decreto nº 8.519 - vigência: 01.01.16)',
      RCTE,
    )
    expect(text).toBe('b) não contribuinte;')
    expect(note).toMatchObject({
      changeKind: ChangeKind.Acrescimo,
      act: { label: 'Decreto nº 8.519', date: null },
      first: '2016-01-01',
      last: null,
      withoutValidity: false,
      unparsed: false,
    })
  })

  it('lê início e fim, "redação original" e "sem vigência"', () => {
    expect(
      extractInlineNote(
        'IV - de 80% (oitenta por cento) do valor: (Redação conferida pela Lei nº 11.750 - vigência: 15.07.92 a 31.12.95)',
        CTE,
      ).note,
    ).toMatchObject({ changeKind: ChangeKind.NovaRedacao, first: '1992-07-15', last: '1995-12-31' })
    expect(
      extractInlineNote('II - texto; (Redação original - vigência: 01.01.98 a 31.12.15).', RCTE)
        .note,
    ).toMatchObject({ changeKind: ChangeKind.Original, first: '1998-01-01', last: '2015-12-31' })
    expect(
      extractInlineNote(
        'I - texto (Redação acrescida pelo Decreto nº 7.000 - vigência: sem - vigência em função da alteração retroagir a 01.01.09)',
        RCTE,
      ).note,
    ).toMatchObject({ withoutValidity: true, first: null })
  })

  it('lê a renumeração inline', () => {
    expect(
      extractInlineNote(
        '§ 1º Texto. (O § 1º vigorou como parágrafo único de 01.01.97 à 28.12.11, quando foi renumerado tacitamente pela Lei nº 17.000)',
        CTE,
      ).note,
    ).toMatchObject({ renumberedFrom: 'paragrafo unico', first: '2011-12-29', unparsed: false })
    expect(
      extractInlineNote(
        '§ 1º Texto. (Renumerado para § 1º o parágrafo único pelo Decreto nº 8.309 - vigência: 29.01.15)',
        RCTE,
      ).note,
    ).toMatchObject({ changeKind: ChangeKind.Renumeracao, first: '2015-01-29' })
  })

  it('marca as notas inline que não dá para ler', () => {
    expect(
      extractInlineNote(
        'I - texto (Redação conferida pelo Decreto nº 7.000 - vigência: 31.02.09)',
        RCTE,
      ).note?.unparsed,
    ).toBe(true)
    expect(
      extractInlineNote(
        'I - texto (Redação conferida pelo Decreto nº 7.000 - vigência: 01.01.09 e 01.02.09)',
        RCTE,
      ).note?.unparsed,
    ).toBe(true)
    expect(
      extractInlineNote(
        '§ 1º Texto (O § 1º vigorou como parágrafo único até 31.02.11, quando foi renumerado)',
        RCTE,
      ).note?.unparsed,
    ).toBe(true)
  })

  it('não confunde parênteses comuns com nota', () => {
    expect(extractInlineNote('I - texto (Convênio ICMS 85/09, cláusula quarta)', RCTE)).toEqual({
      text: 'I - texto (Convênio ICMS 85/09, cláusula quarta)',
      note: null,
    })
    expect(extractInlineNote('I - texto sem parênteses', RCTE).note).toBeNull()
    expect(extractInlineNote('I - texto (Redação dada pelo Decreto nº 1)', RCTE).note).toBeNull()
  })
})

function candidate(overrides: Partial<VersionCandidate>): VersionCandidate {
  return {
    text: 'texto',
    superseded: false,
    amendmentFrom: null,
    amendmentOwn: false,
    amendmentUntil: null,
    exhausted: false,
    inlineFirst: null,
    inlineLast: null,
    noteFirst: null,
    noteLast: null,
    withoutValidity: false,
    parentBlock: null,
    withoutEffect: null,
    marks: [],
    ...overrides,
  }
}

const CONTEXT = { originalFrom: '1998-01-01' } as const

describe('resolveTimeline', () => {
  it('monta a linha do tempo do § 6º do art. 76 (golden do plano)', () => {
    const timeline = resolveTimeline(
      [
        candidate({
          superseded: true,
          amendmentFrom: '2003-09-12',
          amendmentOwn: true,
          noteFirst: '2003-09-12',
          noteLast: '2004-11-03',
        }),
        candidate({
          superseded: true,
          amendmentFrom: '2004-11-04',
          amendmentOwn: true,
          noteFirst: '2004-11-04',
          noteLast: '2009-11-22',
        }),
        candidate({ amendmentFrom: '2009-11-23', amendmentOwn: true }),
      ],
      CONTEXT,
    )
    expect(timeline.versions.map((version) => [version.validDuring, version.review])).toEqual([
      [{ from: '2003-09-12', to: '2004-11-04' }, null],
      [{ from: '2004-11-04', to: '2009-11-23' }, null],
      [{ from: '2009-11-23', to: null }, null],
    ])
    expect(timeline.skipped).toEqual([])
  })

  it('usa a original quando não há nota nem histórico', () => {
    expect(resolveTimeline([candidate({})], CONTEXT).versions[0]?.validDuring).toEqual({
      from: '1998-01-01',
      to: null,
    })
  })

  it('manda "sem vigência" para skipped', () => {
    const timeline = resolveTimeline(
      [
        candidate({ superseded: true, withoutValidity: true }),
        candidate({ amendmentFrom: '1998-01-01', amendmentOwn: true }),
      ],
      CONTEXT,
    )
    expect(timeline.skipped).toEqual([{ index: 0, reason: SkipReason.WithoutValidity }])
    expect(timeline.versions).toHaveLength(1)
  })

  it('fecha a redação com "EXAURIU-SE" no fim da anterior, ou pede revisão', () => {
    const closed = resolveTimeline(
      [
        candidate({
          superseded: true,
          amendmentFrom: '2004-11-01',
          amendmentOwn: true,
          noteFirst: '2004-11-01',
          noteLast: '2004-12-31',
        }),
        candidate({ exhausted: true, amendmentOwn: true }),
      ],
      CONTEXT,
    )
    expect(closed.versions[1]).toMatchObject({
      validDuring: { from: '2005-01-01', to: null },
      review: null,
    })
    const open = resolveTimeline([candidate({ exhausted: true, amendmentOwn: true })], CONTEXT)
    expect(open.versions[0]?.review?.reason).toBe(ReviewReason.ExhaustedAmbiguous)
    const afterOpen = resolveTimeline(
      [
        candidate({ superseded: true, amendmentFrom: '2004-11-01' }),
        candidate({ exhausted: true }),
      ],
      CONTEXT,
    )
    expect(afterOpen.versions[1]).toMatchObject({
      validDuring: { from: '2004-11-01' },
      review: { reason: ReviewReason.ExhaustedAmbiguous },
    })
  })

  it('a abertura do ato próprio vence a nota divergente, com revisão', () => {
    const [version] = resolveTimeline(
      [
        candidate({
          superseded: true,
          amendmentFrom: '2004-06-09',
          amendmentOwn: true,
          noteFirst: '2004-06-08',
          noteLast: '2009-06-09',
        }),
      ],
      CONTEXT,
    ).versions
    expect(version).toMatchObject({
      validDuring: { from: '2004-06-09', to: '2009-06-10' },
      review: { reason: ReviewReason.OpeningMismatch },
    })
  })

  it('a nota vence a abertura herdada do pai, sem revisão', () => {
    const [version] = resolveTimeline(
      [
        candidate({
          superseded: true,
          amendmentFrom: '2002-12-27',
          noteFirst: '2003-01-01',
          noteLast: '2003-09-11',
        }),
      ],
      CONTEXT,
    ).versions
    expect(version).toMatchObject({
      validDuring: { from: '2003-01-01', to: '2003-09-12' },
      review: null,
    })
  })

  it('nota e inline divergentes vão para revisão', () => {
    const [version] = resolveTimeline(
      [
        candidate({
          superseded: true,
          inlineFirst: '2016-01-01',
          noteFirst: '2016-02-01',
          noteLast: '2017-01-01',
        }),
      ],
      CONTEXT,
    ).versions
    expect(version?.review?.reason).toBe(ReviewReason.OpeningMismatch)
  })

  it('filho sem nota própria fecha com o bloco do pai', () => {
    const [version] = resolveTimeline(
      [
        candidate({
          superseded: true,
          amendmentFrom: '1998-12-17',
          parentBlock: { from: '1998-12-17', to: '2008-10-01' },
        }),
      ],
      CONTEXT,
    ).versions
    expect(version).toMatchObject({
      validDuring: { from: '1998-12-17', to: '2008-10-01' },
      review: null,
    })
    const [onlyBlock] = resolveTimeline(
      [candidate({ superseded: true, parentBlock: { from: '2002-12-27', to: '2009-11-23' } })],
      CONTEXT,
    ).versions
    expect(onlyBlock?.validDuring).toEqual({ from: '2002-12-27', to: '2009-11-23' })
  })

  it('superada sem fim: início da seguinte (revisão, salvo nota inline só com o início)', () => {
    const inferred = resolveTimeline(
      [
        candidate({ superseded: true, amendmentFrom: '1998-09-25', amendmentOwn: true }),
        candidate({ amendmentFrom: '2000-12-01', amendmentOwn: true }),
      ],
      CONTEXT,
    ).versions
    expect(inferred[0]).toMatchObject({
      validDuring: { from: '1998-09-25', to: '2000-12-01' },
      review: { reason: ReviewReason.EndInferred },
    })
    const inline = resolveTimeline(
      [
        candidate({ superseded: true, inlineFirst: '2014-08-19' }),
        candidate({ inlineFirst: '2017-02-01' }),
      ],
      CONTEXT,
    ).versions
    expect(inline[0]).toMatchObject({
      validDuring: { from: '2014-08-19', to: '2017-02-01' },
      review: null,
    })
  })

  it('superada sem fim e sem seguinte: revisão com fim aberto', () => {
    const [version] = resolveTimeline(
      [candidate({ superseded: true, amendmentFrom: '2005-04-01' })],
      CONTEXT,
    ).versions
    expect(version).toMatchObject({
      validDuring: { from: '2005-04-01', to: null },
      review: { reason: ReviewReason.EndMissing },
    })
    const twoOpen = resolveTimeline(
      [
        candidate({ superseded: true, amendmentFrom: '2005-04-01' }),
        candidate({ superseded: true }),
      ],
      CONTEXT,
    ).versions
    expect(twoOpen[0]?.review?.reason).toBe(ReviewReason.EndMissing)
  })

  it('vigente sem abertura depois de uma superada: revisão', () => {
    const versions = resolveTimeline(
      [
        candidate({ superseded: true, noteFirst: '2001-01-01', noteLast: '2005-03-31' }),
        candidate({}),
      ],
      CONTEXT,
    ).versions
    expect(versions[1]).toMatchObject({
      validDuring: { from: '2005-04-01', to: null },
      review: { reason: ReviewReason.OpeningMissing },
    })
    const fromStart = resolveTimeline(
      [candidate({ superseded: true, amendmentFrom: '2005-04-01' }), candidate({})],
      CONTEXT,
    ).versions
    expect(fromStart[1]?.validDuring.from).toBe('2005-04-01')
  })

  it('período invertido e duas vigentes vão para revisão', () => {
    const inverted = resolveTimeline(
      [
        candidate({
          superseded: true,
          amendmentFrom: '2023-05-01',
          amendmentOwn: true,
          noteFirst: '2023-05-01',
          noteLast: '2023-04-30',
        }),
      ],
      CONTEXT,
    ).versions
    expect(inverted[0]).toMatchObject({
      validDuring: { from: '2023-05-01', to: '2023-05-02' },
      review: { reason: ReviewReason.IntervalInverted },
    })
    const backwards = resolveTimeline(
      [candidate({ superseded: true, inlineFirst: '2012-12-27', inlineLast: '2012-11-29' })],
      CONTEXT,
    ).versions
    expect(backwards[0]?.validDuring).toEqual({ from: '2012-11-30', to: '2012-12-27' })
    const duplicated = resolveTimeline(
      [
        candidate({ amendmentFrom: '2007-03-20', amendmentOwn: true }),
        candidate({ amendmentFrom: '2010-01-01', amendmentOwn: true }),
      ],
      CONTEXT,
    ).versions
    expect(duplicated.map((version) => version.review?.reason ?? null)).toEqual([
      ReviewReason.DuplicateCurrent,
      null,
    ])
  })

  it('preserva as marcas do parser e usa o fim declarado no ato', () => {
    const [version] = resolveTimeline(
      [
        candidate({
          superseded: true,
          amendmentFrom: '2006-07-12',
          amendmentOwn: true,
          amendmentUntil: '2008-07-31',
          marks: [{ reason: ReviewReason.StyleMismatch, rawNote: 'nota' }],
        }),
      ],
      CONTEXT,
    ).versions
    expect(version).toMatchObject({
      validDuring: { from: '2006-07-12', to: '2008-08-01' },
      review: { reason: ReviewReason.StyleMismatch, rawNote: 'nota' },
    })
  })

  describe('nota "sem efeitos"', () => {
    const SEM_EFEITOS = 'NOTA:Redação do inciso VIII sem efeitos a partir de 23 de junho de 2022'

    it('termina a redação vigente na data, sem redação seguinte (RCTE art. 20, § 1º, VIII)', () => {
      const { versions } = resolveTimeline(
        [
          candidate({ superseded: true, inlineFirst: '2007-01-01', inlineLast: '2017-12-31' }),
          candidate({
            inlineFirst: '2018-01-01',
            withoutEffect: { from: '2022-06-23', until: null, rawNote: SEM_EFEITOS },
          }),
        ],
        CONTEXT,
      )
      expect(versions.map((version) => [version.validDuring, version.review])).toEqual([
        [{ from: '2007-01-01', to: '2018-01-01' }, null],
        [{ from: '2018-01-01', to: '2022-06-23' }, null],
      ])
    })

    it('dá o fim à redação superada sem nota de vigência, e a seguinte começa nele', () => {
      const { versions } = resolveTimeline(
        [
          candidate({
            superseded: true,
            amendmentFrom: '2005-04-01',
            amendmentOwn: true,
            withoutEffect: { from: '2022-06-23', until: null, rawNote: SEM_EFEITOS },
          }),
          candidate({ text: 'a) dispositivo declarado inconstitucional por decisão do STF' }),
        ],
        CONTEXT,
      )
      expect(versions.map((version) => [version.validDuring, version.review?.reason])).toEqual([
        [{ from: '2005-04-01', to: '2022-06-23' }, undefined],
        [{ from: '2022-06-23', to: null }, ReviewReason.OpeningMissing],
      ])
    })

    it('com o período fechado, parte a redação em duas (RCTE art. 20, § 1º, IX)', () => {
      const { versions } = resolveTimeline(
        [
          candidate({
            superseded: true,
            inlineFirst: '2016-01-01',
            noteFirst: '2016-01-01',
            noteLast: '2023-05-31',
            withoutEffect: { from: '2022-06-23', until: '2023-04-29', rawNote: 'nota' },
          }),
          candidate({ amendmentFrom: '2023-06-01', amendmentOwn: true, text: 'IX - Revogado;' }),
        ],
        CONTEXT,
      )
      expect(versions.map((version) => [version.index, version.validDuring])).toEqual([
        [0, { from: '2016-01-01', to: '2022-06-23' }],
        [0, { from: '2023-04-30', to: '2023-06-01' }],
        [1, { from: '2023-06-01', to: null }],
      ])
      expect(versions.every((version) => version.review === null)).toBe(true)
    })

    it('vale o fim mais cedo entre a nota de vigência e a nota "sem efeitos" (CTE art. 27, XII)', () => {
      const [version] = resolveTimeline(
        [
          candidate({
            superseded: true,
            inlineFirst: '2016-01-01',
            noteFirst: '2016-01-01',
            noteLast: '2023-05-31',
            withoutEffect: { from: '2022-06-23', until: null, rawNote: 'nota' },
          }),
        ],
        CONTEXT,
      ).versions
      expect(version?.validDuring).toEqual({ from: '2016-01-01', to: '2022-06-23' })
    })

    it('nota posterior ao fim não muda nada; redação que começa sem efeito vai para revisão', () => {
      const [ended] = resolveTimeline(
        [
          candidate({
            superseded: true,
            noteFirst: '2001-01-01',
            noteLast: '2005-03-31',
            withoutEffect: { from: '2022-06-23', until: null, rawNote: 'nota' },
          }),
        ],
        CONTEXT,
      ).versions
      expect(ended).toMatchObject({
        validDuring: { from: '2001-01-01', to: '2005-04-01' },
        review: null,
      })
      const [late] = resolveTimeline(
        [
          candidate({
            inlineFirst: '2023-01-01',
            withoutEffect: { from: '2022-06-23', until: null, rawNote: 'nota' },
          }),
        ],
        CONTEXT,
      ).versions
      expect(late).toMatchObject({
        validDuring: { from: '2023-01-01', to: null },
        review: { reason: ReviewReason.NoteAmbiguous, rawNote: 'nota' },
      })
    })
  })
})

function timed(
  from: IsoDate,
  to: IsoDate | null,
  text = 'texto',
  review: TimedText['review'] = null,
): TimedText {
  return { validDuring: { from, to }, text, review }
}

describe('mergeIdenticalConsecutive, flagOverlaps e applyRestructuringCut', () => {
  it('funde redações adjacentes com o mesmo texto canônico', () => {
    expect(
      mergeIdenticalConsecutive([
        timed('1998-04-03', '2009-12-29', 'b) abrigada  por benefício'),
        timed('1998-01-01', '1998-04-03', 'b) abrigada por benefício'),
        timed('2009-12-29', null, 'b) revogada'),
      ]).map((version) => version.validDuring),
    ).toEqual([
      { from: '1998-01-01', to: '2009-12-29' },
      { from: '2009-12-29', to: null },
    ])
  })

  it('não funde com lacuna, com revisão nem textos diferentes', () => {
    const pending = { reason: ReviewReason.EndInferred, rawNote: null }
    expect(
      mergeIdenticalConsecutive([timed('1998-01-01', '2000-01-01'), timed('2001-01-01', null)]),
    ).toHaveLength(2)
    expect(
      mergeIdenticalConsecutive([
        timed('1998-01-01', '2000-01-01'),
        timed('2000-01-01', null, 'texto', pending),
      ]),
    ).toHaveLength(2)
    expect(
      mergeIdenticalConsecutive([
        timed('1998-01-01', '2000-01-01', 'a'),
        timed('2000-01-01', null, 'b'),
      ]),
    ).toHaveLength(2)
  })

  it('manda para revisão a versão que cruza uma anterior publicável', () => {
    const result = flagOverlaps([
      timed('2001-12-27', null, 'nova'),
      timed('1998-01-01', '2003-12-27', 'antiga'),
      timed('2010-01-01', null, 'pendente', { reason: ReviewReason.EndMissing, rawNote: null }),
    ])
    expect(result.map((version) => [version.text, version.review?.reason ?? null])).toEqual([
      ['antiga', null],
      ['nova', ReviewReason.Overlap],
      ['pendente', ReviewReason.EndMissing],
    ])
  })

  it('corta o CTE na reestruturação de 1997', () => {
    const pending = { reason: ReviewReason.StyleMismatch, rawNote: null }
    const { versions, clipped } = applyRestructuringCut(
      [
        timed('1992-07-15', '1996-01-01', 'antes'),
        timed('1992-03-01', '1997-01-01', 'antes, pendente', pending),
        timed('1992-03-01', '2000-01-01', 'atravessa'),
        timed('1997-01-01', null, 'depois'),
      ],
      '1997-01-01',
    )
    expect(
      versions.map((version) => [version.validDuring.from, version.review?.reason ?? null]),
    ).toEqual([
      ['1992-07-15', ReviewReason.BeforeRestructuring],
      ['1992-03-01', ReviewReason.StyleMismatch],
      ['1997-01-01', null],
      ['1997-01-01', null],
    ])
    expect(clipped.map((version) => version.text)).toEqual(['atravessa'])
  })
})

// ---------------------------------------------------------------------------------------------
// Propriedades (plano, "Propriedades")

const WINDOW_START = toEpochDay('1998-01-01')
const dayArb = fc.integer({ min: WINDOW_START, max: WINDOW_START + 400 })
const dateArb = dayArb.map(fromEpochDay)

describe('propriedades', () => {
  test.prop([dateArb, fc.integer({ min: 0, max: 400 })])(
    'inclusivo → meio-aberto: o primeiro e o último dia ficam dentro, os vizinhos fora',
    (first, length) => {
      const last = addDays(first, length)
      const interval = inclusiveToHalfOpen(first, last)
      expect(interval).not.toBeNull()
      const half = interval as ValidityInterval
      expect(containsDate(half, first)).toBe(true)
      expect(containsDate(half, last)).toBe(true)
      expect(containsDate(half, addDays(last, 1))).toBe(false)
      expect(containsDate(half, addDays(first, -1))).toBe(false)
    },
  )

  test.prop([fc.integer({ min: 1900, max: 2099 }), fc.integer({ min: 0, max: 99 })])(
    'a data dd.mm.aa formatada volta igual pelo pivô quando o ano está na janela do pivô',
    (pivotYear, offset) => {
      const pivot = pivotYear % 100
      const year = pivotYear + offset > 2099 ? pivotYear + offset - 100 : pivotYear + offset
      fc.pre(year >= 1900 + pivot && year < 2000 + pivot)
      const token = `15.06.${String(year % 100).padStart(2, '0')}`
      expect(parseNoteDate(token, pivot)).toBe(`${year}-06-15`)
    },
  )

  const segmentArb = fc.record({
    start: dayArb,
    length: fc.integer({ min: 1, max: 60 }),
    text: fc.constantFrom('a', 'b', ' a ', 'a​'),
  })

  test.prop([fc.array(segmentArb, { maxLength: 8 })])(
    'merge de idênticas: cobre as mesmas datas e não deixa idênticas adjacentes',
    (segments) => {
      // Uma linha do tempo sem sobreposição: cada segmento começa onde o anterior termina.
      let cursor = WINDOW_START
      const versions = segments.map(({ length, text }) => {
        const from = fromEpochDay(cursor)
        cursor += length
        return timed(from, fromEpochDay(cursor), text)
      })
      const merged = mergeIdenticalConsecutive(versions)
      const covered = (list: readonly TimedText[]) => list.map((version) => version.validDuring)
      for (let day = WINDOW_START; day <= cursor; day += 7) {
        const date = fromEpochDay(day)
        expect(isDateCovered(date, covered(merged))).toBe(isDateCovered(date, covered(versions)))
      }
      merged.slice(1).forEach((current, index) => {
        const previous = merged[index] as TimedText
        const adjacent = previous.validDuring.to === current.validDuring.from
        expect(
          adjacent && previous.text.replace(/[\s​]/g, '') === current.text.replace(/[\s​]/g, ''),
        ).toBe(false)
      })
    },
  )

  test.prop([
    fc.array(fc.record({ start: dayArb, length: fc.option(fc.integer({ min: 1, max: 90 })) }), {
      maxLength: 10,
    }),
  ])('sem sobreposição entre versões publicáveis depois de flagOverlaps', (segments) => {
    const versions = segments.map(({ start, length }) =>
      timed(fromEpochDay(start), length === null ? null : fromEpochDay(start + length)),
    )
    const result = flagOverlaps(versions)
    expect(result).toHaveLength(versions.length)
    const auto = result.filter((version) => version.review === null)
    auto.forEach((a, i) => {
      auto.slice(i + 1).forEach((b) => {
        expect(overlaps(a.validDuring, b.validDuring)).toBe(false)
      })
    })
  })

  test.prop([
    fc.array(fc.stringMatching(/^[a-zçãé0-9§º.,]{1,8}$/), { minLength: 1, maxLength: 8 }),
    fc.constantFrom(' ', '  ', '\t', '\n', '​ '),
  ])(
    'hash invariante a whitespace: textos só com espaços diferentes viram uma versão',
    (words, gap) => {
      const merged = mergeIdenticalConsecutive([
        timed('2000-01-01', '2001-01-01', words.join(' ')),
        timed('2001-01-01', null, `${gap}${words.join(gap)}${gap}`),
      ])
      expect(merged).toHaveLength(1)
      expect(merged[0]?.validDuring).toEqual({ from: '2000-01-01', to: null })
    },
  )
})
