/**
 * Planejamento dos lotes de embedding. O Workers AI (BGE-M3) recusa uma requisição cujo contexto
 * passe de 60.000 tokens, e o contexto conta o lote inteiro preenchido até o texto mais longo
 * (`itens × maior texto`): um lote de 50 trechos de ~4.700 caracteres deu 64.450 tokens (HTTP 400,
 * código 8007). Por isso o lote é limitado por itens (50, como no plano) e por tokens preenchidos,
 * estimados de forma conservadora em `ceil(caracteres / 3)` (a estimativa do plano; o custo real
 * vem na resposta). Os textos são ordenados por tamanho antes, o que junta textos parecidos e reduz
 * o preenchimento (e os neurons cobrados).
 */

export const MAX_BATCH_ITEMS = 50
/** Margem sob o teto de 60.000 tokens do modelo. */
export const MAX_PADDED_TOKENS = 48_000

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3))
}

export interface BatchLimits {
  readonly maxItems: number
  readonly maxPaddedTokens: number
}

/**
 * Divide os índices de `texts` em lotes que respeitam os dois limites. Um texto sozinho acima do
 * teto ainda vira um lote de um (o provedor decide; o chunker já limita o tamanho).
 */
export function planEmbeddingBatches(
  texts: readonly string[],
  limits: BatchLimits = { maxItems: MAX_BATCH_ITEMS, maxPaddedTokens: MAX_PADDED_TOKENS },
): number[][] {
  const order = texts
    .map((text, index) => ({ index, tokens: estimateTokens(text) }))
    .sort((a, b) => a.tokens - b.tokens || a.index - b.index)
  const batches: number[][] = []
  let current: number[] = []
  let longest = 0
  for (const { index, tokens } of order) {
    const nextLongest = Math.max(longest, tokens)
    const fits =
      current.length < limits.maxItems &&
      (current.length + 1) * nextLongest <= limits.maxPaddedTokens
    if (current.length > 0 && !fits) {
      batches.push(current)
      current = []
      longest = 0
    }
    current.push(index)
    longest = Math.max(longest, tokens)
  }
  if (current.length > 0) {
    batches.push(current)
  }
  return batches
}
