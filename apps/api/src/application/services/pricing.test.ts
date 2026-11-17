import { describe, expect, it } from 'vitest'
import { costBreakdown, MODEL_PRICES, shadowCostUsd } from './pricing.ts'

describe('costBreakdown', () => {
  it('separa entrada e saída para o costDetails do Langfuse', () => {
    expect(
      costBreakdown('gemini-3.5-flash-lite', { inputTokens: 10_000, outputTokens: 500 }),
    ).toEqual({ input: 0.001, output: 0.0002, total: 0.0012 })
  })

  it('modelo sem preço custa 0 em tudo', () => {
    expect(costBreakdown('fake-llm-1', { inputTokens: 5, outputTokens: 5 })).toEqual({
      input: 0,
      output: 0,
      total: 0,
    })
  })

  it('a tabela cobre os três modelos da cadeia, sem repetição', () => {
    const models = MODEL_PRICES.map((price) => price.model)
    expect(new Set(models).size).toBe(models.length)
    expect(models).toEqual(
      expect.arrayContaining(['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'openai/gpt-oss-120b']),
    )
  })
})

describe('shadowCostUsd', () => {
  it('soma entrada e saída pelo preço de tabela, com 6 casas', () => {
    expect(shadowCostUsd('gemini-3.6-flash', { inputTokens: 4000, outputTokens: 600 })).toBe(0.0027)
    expect(shadowCostUsd('openai/gpt-oss-120b', { inputTokens: 1, outputTokens: 1 })).toBe(0.000001)
  })

  it('modelo sem preço ou nulo custa 0', () => {
    expect(shadowCostUsd('fake-llm-1', { inputTokens: 1000, outputTokens: 1000 })).toBe(0)
    expect(shadowCostUsd(null, { inputTokens: 1000, outputTokens: 1000 })).toBe(0)
  })
})
