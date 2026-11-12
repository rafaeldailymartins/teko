import { describe, expect, it } from 'vitest'
import type { IngestionRunRepository } from '../ports/ingestion-run-repository.ts'
import {
  createNeuronBudget,
  createNeuronMeter,
  DEFAULT_EMBED_NEURON_BUDGET,
  estimateNeurons,
  NEURONS_PER_MILLION_TOKENS,
} from './neuron-budget.ts'

function runsSpending(spent: number, calls: [string, string][] = []): IngestionRunRepository {
  const fail = () => Promise.reject(new Error('não usado'))
  return {
    start: fail,
    get: fail,
    addNeurons: fail,
    finish: fail,
    neuronsSpentOn: (day, timeZone) => {
      calls.push([day, timeZone])
      return Promise.resolve(spent)
    },
  }
}

describe('estimateNeurons', () => {
  it('usa ceil(chars/3) tokens e 1.075 neurons por milhão de tokens, arredondando para cima', () => {
    expect(NEURONS_PER_MILLION_TOKENS).toBe(1075)
    expect(estimateNeurons([])).toBe(0)
    expect(estimateNeurons(['abc'])).toBe(1)
    // 3 milhões de caracteres = 1 milhão de tokens.
    expect(estimateNeurons(['x'.repeat(3_000_000)])).toBe(1075)
    expect(estimateNeurons(['x'.repeat(1_500_000), 'y'.repeat(1_500_000)])).toBe(1075)
  })
})

describe('NeuronMeter', () => {
  it('acumula o custo informado e os textos sem custo, e zera a cada leitura', () => {
    const meter = createNeuronMeter()
    meter.record({ neurons: 3, texts: 2 })
    meter.record({ neurons: null, texts: 5 })
    meter.record({ neurons: 1.5, texts: 1 })
    expect(meter.take()).toEqual({ neurons: 4.5, unreportedTexts: 5 })
    expect(meter.take()).toEqual({ neurons: 0, unreportedTexts: 0 })
  })
})

describe('NeuronBudget', () => {
  it('desconta o gasto do dia em America/Sao_Paulo', async () => {
    const calls: [string, string][] = []
    const budget = createNeuronBudget({
      runs: runsSpending(2500, calls),
      // 02:00 UTC de 11/11 ainda é 10/11 em São Paulo.
      clock: { now: () => new Date('2026-11-11T02:00:00Z') },
      daily: DEFAULT_EMBED_NEURON_BUDGET,
    })
    expect(budget.daily).toBe(8000)
    expect(await budget.remaining()).toBe(5500)
    expect(calls).toEqual([['2026-11-10', 'America/Sao_Paulo']])
  })

  it('nunca fica negativo e aceita outro fuso', async () => {
    const calls: [string, string][] = []
    const budget = createNeuronBudget({
      runs: runsSpending(9000, calls),
      clock: { now: () => new Date('2026-11-11T02:00:00Z') },
      daily: 8000,
      timeZone: 'UTC',
    })
    expect(await budget.remaining()).toBe(0)
    expect(calls).toEqual([['2026-11-11', 'UTC']])
  })

  it('recusa teto inválido', () => {
    const base = { runs: runsSpending(0), clock: { now: () => new Date() } }
    expect(() => createNeuronBudget({ ...base, daily: -1 })).toThrow(RangeError)
    expect(() => createNeuronBudget({ ...base, daily: 1.5 })).toThrow(RangeError)
    expect(createNeuronBudget({ ...base, daily: 0 }).daily).toBe(0)
  })
})
