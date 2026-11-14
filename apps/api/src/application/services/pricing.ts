import type { LlmUsage } from '../ports/llm-port.ts'

/**
 * Custo-sombra (`shadow_cost_usd`): quanto a resposta custaria no plano pago do provedor, para
 * acompanhar o valor do que o free tier entrega e a projeção de custo se o projeto um dia sair
 * dele. Preço de tabela por milhão de tokens, em USD, na data indicada; modelo sem preço conhecido
 * custa 0 (e aparece assim no painel da F6). Versionado aqui (preços de 2026-11-14), revisto quando
 * um modelo da cadeia mudar.
 */

interface ModelPrice {
  readonly inputPerMillion: number
  readonly outputPerMillion: number
}

const PRICING_USD: Readonly<Record<string, ModelPrice>> = {
  'gemini-3.6-flash': { inputPerMillion: 0.3, outputPerMillion: 2.5 },
  'gemini-3.5-flash-lite': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  'openai/gpt-oss-120b': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
}

/** Custo-sombra em USD, com 6 casas (a coluna é `numeric(10, 6)`). */
export function shadowCostUsd(model: string | null, usage: LlmUsage): number {
  const price = model === null ? undefined : PRICING_USD[model]
  if (price === undefined) {
    return 0
  }
  const cost =
    (usage.inputTokens * price.inputPerMillion + usage.outputTokens * price.outputPerMillion) /
    1_000_000
  return Math.round(cost * 1_000_000) / 1_000_000
}
