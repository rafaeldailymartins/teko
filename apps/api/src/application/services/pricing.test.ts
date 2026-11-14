import { describe, expect, it } from 'vitest'
import { shadowCostUsd } from './pricing.ts'

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
