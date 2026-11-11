import { test } from '@fast-check/vitest'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  estimateTokens,
  MAX_BATCH_ITEMS,
  MAX_PADDED_TOKENS,
  planEmbeddingBatches,
} from './embedding-batches.ts'

describe('planEmbeddingBatches', () => {
  it('estima ceil(caracteres / 3), no mínimo 1', () => {
    expect(estimateTokens('')).toBe(1)
    expect(estimateTokens('abc')).toBe(1)
    expect(estimateTokens('abcd')).toBe(2)
    expect(MAX_BATCH_ITEMS).toBe(50)
    expect(MAX_PADDED_TOKENS).toBe(48_000)
  })

  it('textos curtos: lotes de 50 itens', () => {
    const batches = planEmbeddingBatches(Array.from({ length: 120 }, () => 'texto curto'))
    expect(batches.map((batch) => batch.length)).toEqual([50, 50, 20])
  })

  it('o lote de 50 trechos de ~4.700 caracteres que estourou o Workers AI é dividido', () => {
    const texts = Array.from({ length: 50 }, () => 'x'.repeat(4700))
    const batches = planEmbeddingBatches(texts)
    // 4.700 / 3 = 1.567 tokens; 30 × 1.567 = 47.010 ≤ 48.000 < 31 × 1.567.
    expect(batches.map((batch) => batch.length)).toEqual([30, 20])
  })

  it('ordena por tamanho e preserva os índices originais', () => {
    expect(planEmbeddingBatches(['x'.repeat(9), 'x', 'x'.repeat(5)])).toEqual([[1, 2, 0]])
    // Empate na estimativa: mantém a ordem original.
    expect(planEmbeddingBatches(['ccc', 'a', 'bb'])).toEqual([[0, 1, 2]])
    expect(planEmbeddingBatches([], { maxItems: 2, maxPaddedTokens: 10 })).toEqual([])
  })

  it('um texto acima do teto vira um lote sozinho', () => {
    expect(
      planEmbeddingBatches(['x'.repeat(30), 'y'], { maxItems: 5, maxPaddedTokens: 5 }),
    ).toEqual([[1], [0]])
  })
})

describe('propriedades', () => {
  test.prop([
    fc.array(fc.string({ maxLength: 400 }), { maxLength: 200 }),
    fc.integer({ min: 1, max: 60 }),
    fc.integer({ min: 200, max: 5000 }),
  ])(
    'cada índice entra em um lote, e os lotes respeitam os limites',
    (texts, maxItems, maxPaddedTokens) => {
      const batches = planEmbeddingBatches(texts, { maxItems, maxPaddedTokens })
      const indexes = batches.flat().sort((a, b) => a - b)
      expect(indexes).toEqual(texts.map((_, index) => index))
      for (const batch of batches) {
        expect(batch.length).toBeGreaterThan(0)
        expect(batch.length).toBeLessThanOrEqual(maxItems)
        const longest = Math.max(...batch.map((index) => estimateTokens(texts[index] ?? '')))
        if (batch.length > 1) {
          expect(batch.length * longest).toBeLessThanOrEqual(maxPaddedTokens)
        }
      }
    },
  )
})
