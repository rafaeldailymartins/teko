import { test } from '@fast-check/vitest'
import { addDays, containsDate, fromEpochDay, toEpochDay } from '@teko/shared/vigencia'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Modality } from './family.ts'
import {
  declaredStartInNote,
  LeiauteReviewReason,
  leiautePeriodIntervals,
  monthNumber,
  narrowByDeclaredStart,
  ntValidity,
  overlappingRowIndexes,
  parseDdMmAaaa,
  parsePortugueseDate,
  publicationInterval,
  publicationIntervals,
  tableRowInterval,
} from './leiaute-validity.ts'

const dateArb = fc
  .integer({ min: toEpochDay('2000-01-01'), max: toEpochDay('2035-12-31') })
  .map((day) => fromEpochDay(day))

describe('leiautePeriodIntervals (Guia Prático e REINF)', () => {
  it('cada versão vale do início do seu período até o início do seguinte', () => {
    const intervals = leiautePeriodIntervals([
      { id: '3.1.9', from: '2025-01-01' },
      { id: '3.2.4', from: '2026-01-01' },
      { id: '3.1.8', from: '2025-01-01' },
    ])
    expect(intervals.get('3.1.9')).toEqual({ from: '2025-01-01', to: '2026-01-01' })
    // Corretiva no mesmo período: mesmo tempo válido (o knowledge é fechado na reconciliação).
    expect(intervals.get('3.1.8')).toEqual({ from: '2025-01-01', to: '2026-01-01' })
    expect(intervals.get('3.2.4')).toEqual({ from: '2026-01-01', to: null })
  })

  it('a ordem das entradas não importa', () => {
    const intervals = leiautePeriodIntervals([
      { id: 'b', from: '2026-01-01' },
      { id: 'a', from: '2025-01-01' },
      { id: 'c', from: '2024-01-01' },
    ])
    expect(intervals.get('c')).toEqual({ from: '2024-01-01', to: '2025-01-01' })
    expect(intervals.get('a')).toEqual({ from: '2025-01-01', to: '2026-01-01' })
  })

  it('rejeita data inválida e versão repetida', () => {
    expect(() => leiautePeriodIntervals([{ id: 'x', from: '2025-13-01' }])).toThrow(
      /Início de leiaute inválido em x/,
    )
    expect(() =>
      leiautePeriodIntervals([
        { id: 'x', from: '2025-01-01' },
        { id: 'x', from: '2026-01-01' },
      ]),
    ).toThrow(/repetida/)
  })

  test.prop([fc.uniqueArray(dateArb, { minLength: 1, maxLength: 8 })])(
    'os períodos de datas distintas não se sobrepõem e cobrem tudo desde o primeiro',
    (starts) => {
      const intervals = leiautePeriodIntervals(
        starts.map((from, index) => ({ id: `v${index}`, from })),
      )
      const sorted = [...intervals.values()].sort((a, b) =>
        String(a.from).localeCompare(String(b.from)),
      )
      sorted.forEach((interval, index) => {
        const next = sorted[index + 1]
        expect(interval.to).toBe(next === undefined ? null : next.from)
      })
    },
  )
})

describe('narrowByDeclaredStart', () => {
  const document = { from: '2026-01-01', to: '2027-01-01' } as const

  it('sem início declarado ou com início histórico, fica a vigência do documento', () => {
    expect(narrowByDeclaredStart(document, null)).toEqual({ validDuring: document })
    expect(narrowByDeclaredStart(document, '2017-01-01')).toEqual({ validDuring: document })
    expect(narrowByDeclaredStart(document, '2026-01-01')).toEqual({ validDuring: document })
  })

  it('início dentro da vigência estreita o intervalo', () => {
    expect(narrowByDeclaredStart(document, '2026-07-01')).toEqual({
      validDuring: { from: '2026-07-01', to: '2027-01-01' },
    })
    expect(narrowByDeclaredStart({ from: '2026-01-01', to: null }, '2027-01-01')).toEqual({
      validDuring: { from: '2027-01-01', to: null },
    })
  })

  it('início no fim do documento ou depois vai para revisão', () => {
    expect(narrowByDeclaredStart(document, '2027-01-01', 'Campo 09 …')).toEqual({
      validDuring: document,
      review: { reason: LeiauteReviewReason.OutsideDocumentValidity, rawNote: 'Campo 09 …' },
    })
    expect(
      narrowByDeclaredStart({ from: null, to: '2020-01-01' }, '2021-01-01').review?.rawNote,
    ).toBeNull()
  })

  test.prop([dateArb, fc.option(dateArb, { nil: null }), fc.option(dateArb, { nil: null })])(
    'o resultado nunca sai da vigência do documento e nunca é vazio',
    (from, maybeTo, start) => {
      const to = maybeTo !== null && maybeTo > from ? maybeTo : null
      const documentValidity = { from, to }
      const { validDuring, review } = narrowByDeclaredStart(documentValidity, start)
      expect(validDuring.from !== null && validDuring.from >= from).toBe(true)
      expect(validDuring.to).toBe(to)
      expect(validDuring.to === null || (validDuring.from ?? '') < validDuring.to).toBe(true)
      expect(review !== undefined).toBe(start !== null && to !== null && start >= to)
    },
  )
})

describe('datas em português', () => {
  it('lê as formas numéricas, por extenso e mês/ano', () => {
    expect(parsePortugueseDate('01/01/2027')).toBe('2027-01-01')
    expect(parsePortugueseDate('1.4.2010')).toBe('2010-04-01')
    expect(parsePortugueseDate('30-06-2012')).toBe('2012-06-30')
    expect(parsePortugueseDate('1º de janeiro de 2027')).toBe('2027-01-01')
    expect(parsePortugueseDate('01 de  ABRIL de 2010')).toBe('2010-04-01')
    expect(parsePortugueseDate('março de 2024')).toBe('2024-03-01')
  })

  it('devolve null para formas desconhecidas e datas inexistentes', () => {
    expect(parsePortugueseDate('31/02/2027')).toBeNull()
    expect(parsePortugueseDate('1 de brumário de 2027')).toBeNull()
    expect(parsePortugueseDate('brumário de 2027')).toBeNull()
    expect(parsePortugueseDate('2027')).toBeNull()
    expect(parsePortugueseDate(' 01/01/2027 ')).toBe('2027-01-01')
    expect(parsePortugueseDate('x01/01/2027')).toBeNull()
    expect(parsePortugueseDate('01/01/20271')).toBeNull()
    expect(parsePortugueseDate('x 1 de janeiro de 2027')).toBeNull()
    expect(parsePortugueseDate('1 de janeiro de 2027x')).toBeNull()
    expect(parsePortugueseDate('em janeiro de 2027')).toBeNull()
    expect(parsePortugueseDate('janeiro de 20271')).toBeNull()
    expect(monthNumber('Março')).toBe(3)
    expect(monthNumber('mar')).toBeNull()
  })

  it('início declarado: só verbos de validade e inclusão, a data mais tardia', () => {
    expect(declaredStartInNote('(Válido a partir de 01/01/2019)')).toBe('2019-01-01')
    expect(declaredStartInNote('O campo CEST é válido a partir de 01/01/2017.')).toBe('2017-01-01')
    expect(
      declaredStartInNote('Campos incluídos a partir do período de apuração de janeiro de 2027.'),
    ).toBe('2027-01-01')
    expect(
      declaredStartInNote(
        'Os campos 10 a 26 são válidos a partir de 01/01/2017 e obrigatórios a partir de 01/01/2019',
      ),
    ).toBe('2019-01-01')
    expect(declaredStartInNote('A partir de 01/01/2018: Valores válidos: [0, 1]')).toBeNull()
    expect(declaredStartInNote('válido a partir de 31/02/2019')).toBeNull()
    expect(declaredStartInNote('VÁLIDO A PARTIR DE 01/01/2019')).toBe('2019-01-01')
    expect(
      declaredStartInNote('válido a partir de 31/02/2019, válido a partir de 01/01/2018'),
    ).toBe('2018-01-01')
    expect(
      declaredStartInNote('válido a partir de 01/01/2019 e válido a partir de 01/01/2018'),
    ).toBe('2019-01-01')
  })
})

describe('ntValidity (Notas Técnicas)', () => {
  it('facultativa em [optional_from, mandatory_from) e obrigatória em [mandatory_from, próxima)', () => {
    expect(
      ntValidity({
        publishedOn: '2025-06-01',
        effectiveFrom: null,
        optionalFrom: '2025-07-01',
        mandatoryFrom: '2026-01-01',
        nextFrom: '2027-01-01',
      }),
    ).toEqual({
      versions: [
        {
          validDuring: { from: '2025-07-01', to: '2026-01-01' },
          modality: Modality.Optional,
          retroactive: false,
        },
        {
          validDuring: { from: '2026-01-01', to: '2027-01-01' },
          modality: Modality.Mandatory,
          retroactive: false,
        },
      ],
    })
  })

  it('efeito anterior à publicação marca retroactive; sem datas, vale a publicação', () => {
    expect(
      ntValidity({
        publishedOn: '2025-06-01',
        effectiveFrom: '2025-01-01',
        optionalFrom: null,
        mandatoryFrom: null,
        nextFrom: null,
      }),
    ).toEqual({
      versions: [
        {
          validDuring: { from: '2025-01-01', to: null },
          modality: Modality.Mandatory,
          retroactive: true,
        },
      ],
    })
    expect(
      ntValidity({
        publishedOn: '2025-06-01',
        effectiveFrom: null,
        optionalFrom: null,
        mandatoryFrom: null,
        nextFrom: null,
      }).versions,
    ).toEqual([
      {
        validDuring: { from: '2025-06-01', to: null },
        modality: Modality.Mandatory,
        retroactive: false,
      },
    ])
  })

  it('próxima versão antes da obrigatoriedade: sobra a facultativa e a NT vai para revisão', () => {
    const result = ntValidity({
      publishedOn: '2025-06-01',
      effectiveFrom: null,
      optionalFrom: '2025-07-01',
      mandatoryFrom: '2026-01-01',
      nextFrom: '2025-10-01',
    })
    expect(result.versions).toEqual([
      {
        validDuring: { from: '2025-07-01', to: '2025-10-01' },
        modality: Modality.Optional,
        retroactive: false,
      },
    ])
    expect(result.review?.reason).toBe(LeiauteReviewReason.NtEmptyMandatory)
    expect(
      ntValidity({
        publishedOn: '2025-06-01',
        effectiveFrom: null,
        optionalFrom: '2025-07-01',
        mandatoryFrom: '2026-01-01',
        nextFrom: '2025-07-01',
      }).versions,
    ).toEqual([])
  })

  test.prop([
    dateArb,
    fc.option(dateArb, { nil: null }),
    fc.option(dateArb, { nil: null }),
    fc.option(dateArb, { nil: null }),
    fc.option(dateArb, { nil: null }),
  ])(
    'versões sem sobreposição, nunca vazias, e no máximo uma obrigatória',
    (publishedOn, effectiveFrom, optionalFrom, mandatoryFrom, nextFrom) => {
      const { versions, review } = ntValidity({
        publishedOn,
        effectiveFrom,
        optionalFrom,
        mandatoryFrom,
        nextFrom,
      })
      expect(versions.filter((v) => v.modality === Modality.Mandatory).length).toBeLessThanOrEqual(
        1,
      )
      expect(
        versions.length === 0 ||
          review === undefined ||
          versions[0]?.modality === Modality.Optional,
      ).toBe(true)
      for (const [index, version] of versions.entries()) {
        const { from, to } = version.validDuring
        expect(to === null || (from ?? '') < to).toBe(true)
        const next = versions[index + 1]
        if (next !== undefined) {
          expect(to).toBe(next.validDuring.from)
        }
        expect(version.retroactive).toBe(
          (effectiveFrom ?? optionalFrom ?? mandatoryFrom ?? publishedOn) < publishedOn,
        )
      }
    },
  )
})

describe('publicationInterval (Guia EFD-GO)', () => {
  it('[publicação, próxima publicação)', () => {
    expect(publicationInterval('2025-10-02', '2026-03-16')).toEqual({
      from: '2025-10-02',
      to: '2026-03-16',
    })
    expect(publicationInterval('2026-03-16', null)).toEqual({ from: '2026-03-16', to: null })
    expect(() => publicationInterval('2026-03-16', '2026-03-16')).toThrow(RangeError)
  })

  it('série de publicações, com datas repetidas e fora de ordem', () => {
    const intervals = publicationIntervals(['2026-03-16', '2025-10-02', '2026-03-16'])
    expect([...intervals.entries()]).toEqual([
      ['2025-10-02', { from: '2025-10-02', to: '2026-03-16' }],
      ['2026-03-16', { from: '2026-03-16', to: null }],
    ])
  })

  test.prop([fc.uniqueArray(dateArb, { minLength: 1, maxLength: 10 })])(
    'toda data a partir da primeira publicação cai em exatamente uma versão',
    (dates) => {
      const intervals = [...publicationIntervals(dates).values()]
      const probe = addDays([...dates].sort()[0] ?? '2000-01-01', 17)
      expect(intervals.filter((interval) => containsDate(interval, probe))).toHaveLength(1)
    },
  )
})

describe('Tabelas de Goiás', () => {
  it('DDMMAAAA', () => {
    expect(parseDdMmAaaa('01012009')).toBe('2009-01-01')
    expect(parseDdMmAaaa(' 30062024 ')).toBe('2024-06-30')
    expect(parseDdMmAaaa('')).toBeNull()
    expect(parseDdMmAaaa('31022024')).toBeNull()
    expect(parseDdMmAaaa('2024-06-30')).toBeNull()
    expect(parseDdMmAaaa('101012009')).toBeNull()
    expect(parseDdMmAaaa('010120091')).toBeNull()
  })

  it('[DT_INI, DT_FIM + 1); DT_FIM vazio = vigente; DT_FIM antes de DT_INI = vazio', () => {
    expect(tableRowInterval('2009-01-01', '2024-06-30')).toEqual({
      from: '2009-01-01',
      to: '2024-07-01',
    })
    expect(tableRowInterval('2009-01-01', null)).toEqual({ from: '2009-01-01', to: null })
    expect(tableRowInterval('2009-01-01', '2009-01-01')).toEqual({
      from: '2009-01-01',
      to: '2009-01-02',
    })
    expect(tableRowInterval('2009-01-02', '2009-01-01')).toBeNull()
  })

  it('linhas sobrepostas do mesmo código', () => {
    expect(
      overlappingRowIndexes([
        { from: '2009-01-01', to: '2020-10-01' },
        { from: '2020-10-01', to: null },
        { from: '2021-01-01', to: '2022-01-01' },
      ]),
    ).toEqual([2])
    expect(overlappingRowIndexes([])).toEqual([])
  })

  test.prop([dateArb, fc.integer({ min: 0, max: 4000 })])(
    'a conversão de intervalo inclusivo para meio-aberto inclui DT_INI e DT_FIM e exclui DT_FIM + 1',
    (dtIni, length) => {
      const dtFim = addDays(dtIni, length)
      const interval = tableRowInterval(dtIni, dtFim)
      expect(interval).not.toBeNull()
      if (interval !== null) {
        expect(containsDate(interval, dtIni)).toBe(true)
        expect(containsDate(interval, dtFim)).toBe(true)
        expect(containsDate(interval, addDays(dtFim, 1))).toBe(false)
      }
    },
  )
})
