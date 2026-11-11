import { ReferenceSource } from '@teko/shared/vigencia'
import { describe, expect, it } from 'vitest'
import {
  markPeriodBoundary,
  type ReferenceResolution,
  ResolutionKind,
  type ResolvedReference,
  resolveReferenceDate,
} from './reference-resolution.ts'

/** Relógio fixo dos testes: 2026-11-10 em America/Sao_Paulo. */
const TODAY = '2026-11-10'

function resolved(resolution: ReferenceResolution): ResolvedReference {
  if (resolution.kind !== ResolutionKind.Resolved) {
    throw new Error(`esperava resolved, veio ${resolution.kind}`)
  }
  return resolution.reference
}

describe('resolveReferenceDate', () => {
  it('default: dia 1 do mês anterior a hoje', () => {
    expect(
      resolved(
        resolveReferenceDate({
          input: { periodoApuracao: '2026-10' },
          source: ReferenceSource.Default,
          questionText: 'Qual o prazo de entrega da EFD?',
          today: TODAY,
        }),
      ),
    ).toEqual({
      value: '2026-10-01',
      source: 'default',
      periodBoundaryInside: false,
      alternatives: [],
      periodo: '2026-10',
    })
  })

  it('PA explícito resolve para o dia 1, com o período guardado', () => {
    expect(
      resolved(
        resolveReferenceDate({
          input: { periodoApuracao: '2006-05' },
          source: ReferenceSource.PeriodoApuracao,
          questionText: 'Qual o prazo do art. 76?',
          today: TODAY,
        }),
      ),
    ).toMatchObject({ value: '2006-05-01', source: 'periodo_apuracao', periodo: '2006-05' })
  })

  it('data explícita fica sem período', () => {
    expect(
      resolved(
        resolveReferenceDate({
          input: { referenceDate: '2006-05-17' },
          source: ReferenceSource.Explicit,
          questionText: 'prazo',
          today: TODAY,
        }),
      ),
    ).toMatchObject({ value: '2006-05-17', source: 'explicit', periodo: null })
  })

  it.each([
    ['O que valia em 05/2006?', '2006-05-01', '2006-05'],
    ['E em maio de 2006?', '2006-05-01', '2006-05'],
    ['Em March 2024, qual o leiaute?', '2024-03-01', '2024-03'],
    ['Nota emitida em 15/03/2024', '2024-03-15', null],
    ['Fato gerador em 2024-03-15', '2024-03-15', null],
  ])('data única no texto (%s) vira question_text', (questionText, value, periodo) => {
    expect(
      resolved(
        resolveReferenceDate({
          input: { periodoApuracao: '2026-10' },
          source: ReferenceSource.Default,
          questionText,
          today: TODAY,
        }),
      ),
    ).toMatchObject({ value, source: 'question_text', periodo })
  })

  it('a mesma data em formatos de mês diferentes conta como uma', () => {
    expect(
      resolved(
        resolveReferenceDate({
          input: { periodoApuracao: '2026-10' },
          source: ReferenceSource.QuestionText,
          questionText: 'maio de 2006, ou seja, 05/2006',
          today: TODAY,
        }),
      ),
    ).toMatchObject({ value: '2006-05-01', source: 'question_text', periodo: '2006-05' })
  })

  it('datas conflitantes no texto pedem esclarecimento, em ordem', () => {
    expect(
      resolveReferenceDate({
        input: { periodoApuracao: '2026-10' },
        source: ReferenceSource.Default,
        questionText: 'Comparar 01/2010 com 03/2004',
        today: TODAY,
      }),
    ).toEqual({
      kind: ResolutionKind.NeedsClarification,
      reason: 'ambiguous_text',
      candidates: ['2004-03-01', '2010-01-01'],
    })
  })

  it('data do texto diferente do PA explícito pede esclarecimento com as duas', () => {
    expect(
      resolveReferenceDate({
        input: { periodoApuracao: '2006-05' },
        source: ReferenceSource.PeriodoApuracao,
        questionText: 'Como era em 01/2010?',
        today: TODAY,
      }),
    ).toEqual({
      kind: ResolutionKind.NeedsClarification,
      reason: 'explicit_conflict',
      candidates: ['2006-05-01', '2010-01-01'],
    })
  })

  it('menção no mesmo mês do PA é compatível e vira alternativa', () => {
    expect(
      resolved(
        resolveReferenceDate({
          input: { periodoApuracao: '2006-05' },
          source: ReferenceSource.PeriodoApuracao,
          questionText: 'Nota de 17/05/2006, no PA de maio de 2006',
          today: TODAY,
        }),
      ),
    ).toMatchObject({ value: '2006-05-01', alternatives: ['2006-05-17'] })
  })

  it('com data explícita, só a mesma data ou uma menção mensal do mesmo mês são compatíveis', () => {
    const base = {
      input: { referenceDate: '2006-05-17' },
      source: ReferenceSource.Explicit,
      today: TODAY,
    } as const
    expect(resolved(resolveReferenceDate({ ...base, questionText: 'em 17/05/2006' })).value).toBe(
      '2006-05-17',
    )
    expect(
      resolved(resolveReferenceDate({ ...base, questionText: 'em maio de 2006' })).alternatives,
    ).toEqual(['2006-05-01'])
    expect(resolveReferenceDate({ ...base, questionText: 'em 20/05/2006' })).toMatchObject({
      kind: 'needs_clarification',
      reason: 'explicit_conflict',
      candidates: ['2006-05-17', '2006-05-20'],
    })
  })

  it('clarified não confronta o texto de novo', () => {
    expect(
      resolved(
        resolveReferenceDate({
          input: { periodoApuracao: '2010-01' },
          source: ReferenceSource.Clarified,
          questionText: 'Comparar 01/2010 com 03/2004',
          today: TODAY,
        }),
      ),
    ).toMatchObject({
      value: '2010-01-01',
      source: 'clarified',
      alternatives: [],
      periodo: '2010-01',
    })
  })
})

describe('markPeriodBoundary', () => {
  const fromPa: ResolvedReference = {
    value: '2026-07-01',
    source: ReferenceSource.PeriodoApuracao,
    periodBoundaryInside: false,
    alternatives: [],
    periodo: '2026-07',
  }

  it('liga com fronteira de vigência dentro do mês do PA', () => {
    const marked = markPeriodBoundary(fromPa, [{ from: '2026-07-28', to: null }])
    expect(marked.periodBoundaryInside).toBe(true)
    expect(marked).not.toBe(fromPa)
  })

  it('não liga com fronteira no dia 1 ou fora do mês, e devolve o mesmo objeto', () => {
    expect(markPeriodBoundary(fromPa, [{ from: '2026-07-01', to: '2026-08-01' }])).toBe(fromPa)
    expect(markPeriodBoundary(fromPa, [{ from: '2004-11-04', to: '2009-11-23' }])).toBe(fromPa)
  })

  it('não se aplica a datas que não vieram de um PA', () => {
    const exact = { ...fromPa, periodo: null }
    expect(markPeriodBoundary(exact, [{ from: '2026-07-28', to: null }])).toBe(exact)
  })

  it('desliga quando já estava ligada e a evidência não tem fronteira no mês', () => {
    const on = { ...fromPa, periodBoundaryInside: true }
    expect(markPeriodBoundary(on, []).periodBoundaryInside).toBe(false)
  })
})
