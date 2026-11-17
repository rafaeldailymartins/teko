import type { LlmUsage } from '../ports/llm-port.ts'

/**
 * Custo-sombra (`shadow_cost_usd`): quanto a resposta custaria no plano pago do provedor, para
 * acompanhar o valor do que o free tier entrega e a projeção de custo se o projeto um dia sair
 * dele. Preço de tabela por milhão de tokens, em USD, na data indicada; modelo sem preço conhecido
 * custa 0 (e aparece assim no painel da F6). Versionado aqui (preços de 2026-11-14), revisto quando
 * um modelo da cadeia mudar.
 *
 * A mesma tabela alimenta o `costDetails` das generations do Langfuse e os modelos cadastrados em
 * Settings → Models pelo job `langfuse` do `ops.yml` (`scripts/langfuse-ops.ts`).
 */

export interface ModelPrice {
  /** Nome exato do modelo, como a cadeia o chama (`gen_ai.request.model`). */
  readonly model: string
  readonly inputPerMillion: number
  readonly outputPerMillion: number
}

/** Data dos preços de tabela (início da vigência dos modelos no Langfuse). */
export const PRICING_DATE = '2026-11-14'

export const MODEL_PRICES: readonly ModelPrice[] = [
  { model: 'gemini-3.6-flash', inputPerMillion: 0.3, outputPerMillion: 2.5 },
  { model: 'gemini-3.5-flash-lite', inputPerMillion: 0.1, outputPerMillion: 0.4 },
  { model: 'openai/gpt-oss-120b', inputPerMillion: 0.15, outputPerMillion: 0.6 },
]

/** Custo por parte do uso, em USD com 6 casas (`costDetails` do Langfuse). */
export interface CostBreakdown {
  readonly input: number
  readonly output: number
  readonly total: number
}

const round6 = (value: number): number => Math.round(value * 1_000_000) / 1_000_000

/** Custo de entrada, saída e total a preço de tabela; modelo sem preço (ou nulo) custa 0. */
export function costBreakdown(model: string | null, usage: LlmUsage): CostBreakdown {
  const price = MODEL_PRICES.find((candidate) => candidate.model === model)
  if (price === undefined) {
    return { input: 0, output: 0, total: 0 }
  }
  const input = (usage.inputTokens * price.inputPerMillion) / 1_000_000
  const output = (usage.outputTokens * price.outputPerMillion) / 1_000_000
  return { input: round6(input), output: round6(output), total: round6(input + output) }
}

/** Custo-sombra em USD, com 6 casas (a coluna é `numeric(10, 6)`). */
export function shadowCostUsd(model: string | null, usage: LlmUsage): number {
  return costBreakdown(model, usage).total
}
