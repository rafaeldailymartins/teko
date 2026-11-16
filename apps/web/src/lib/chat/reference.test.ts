import { describe, expect, it } from 'vitest'
import {
  clarifiedRequest,
  corpusTimelinePosition,
  defaultPeriodo,
  EFD_DELIVERY_DAY,
  referenceDisplay,
  referencePresets,
  referenceRequest,
} from './reference.ts'

describe('referenceRequest (chip da data de referência)', () => {
  it('sem escolha: mês anterior com source default', () => {
    expect(referenceRequest(null, '2026-11-15')).toEqual({
      periodoApuracao: '2026-10',
      source: 'default',
    })
    expect(referenceRequest(null, '2026-01-31')).toEqual({
      periodoApuracao: '2025-12',
      source: 'default',
    })
  })

  it('período escolhido vai como periodo_apuracao; data exata, como explicit', () => {
    expect(referenceRequest({ periodoApuracao: '2008-05' }, '2026-11-15')).toEqual({
      periodoApuracao: '2008-05',
      source: 'periodo_apuracao',
    })
    expect(referenceRequest({ referenceDate: '2010-01-15' }, '2026-11-15')).toEqual({
      referenceDate: '2010-01-15',
      source: 'explicit',
    })
  })

  it('esclarecimento vai como clarified, com a data exata', () => {
    expect(clarifiedRequest('2010-01-01')).toEqual({
      referenceDate: '2010-01-01',
      source: 'clarified',
    })
  })
})

describe('referencePresets', () => {
  it('mês anterior, mês atual e último período fechado', () => {
    expect(defaultPeriodo('2024-03-10')).toBe('2024-02')
    expect(referencePresets('2024-03-10')).toEqual({
      previousMonth: '2024-02',
      currentMonth: '2024-03',
      lastClosed: '2024-01',
    })
  })

  it('depois do prazo de entrega, o mês anterior já está fechado', () => {
    expect(referencePresets(`2024-03-${EFD_DELIVERY_DAY}`).lastClosed).toBe('2024-01')
    expect(referencePresets(`2024-03-${EFD_DELIVERY_DAY + 1}`).lastClosed).toBe('2024-02')
  })
})

describe('referenceDisplay', () => {
  it('mostra o default como período marcado', () => {
    expect(referenceDisplay(null, '2024-04-02')).toEqual({
      kind: 'periodo',
      periodo: '2024-03',
      isDefault: true,
    })
  })

  it('mostra o período ou a data escolhidos', () => {
    expect(referenceDisplay({ periodoApuracao: '2008-05' }, '2024-04-02')).toEqual({
      kind: 'periodo',
      periodo: '2008-05',
      isDefault: false,
    })
    expect(referenceDisplay({ referenceDate: '2010-01-15' }, '2024-04-02')).toEqual({
      kind: 'date',
      date: '2010-01-15',
      isDefault: false,
    })
  })
})

describe('corpusTimelinePosition', () => {
  it('vai de 1998 ao fim do ano de hoje, sem passar das pontas', () => {
    expect(corpusTimelinePosition('1998-01-01', '2026-11-15')).toBe(0)
    expect(corpusTimelinePosition('2012-07-01', '2026-11-15')).toBeCloseTo(0.5, 2)
    expect(corpusTimelinePosition('1990-01-01', '2026-11-15')).toBe(0)
    expect(corpusTimelinePosition('2030-01-01', '2026-11-15')).toBe(1)
  })
})
