import { isoDateInTimeZone } from '@teko/shared/vigencia'
import type { Clock } from '../ports/clock.ts'
import type { IngestionRunRepository } from '../ports/ingestion-run-repository.ts'
import { estimateTokens } from './embedding-batches.ts'

/**
 * Orçamento diário de neurons da ingestão (plano, "Embeddings e orçamento de neurons"): dos 10.000
 * neurons/dia da conta Workers AI Free, 8.000 são da ingestão (`EMBED_NEURON_BUDGET`). O gasto é o
 * custo real que o adapter informa (`onUsage`: `result.meta.neurons` ou o header `cf-ai-neurons`),
 * somado em `ingestion_runs.neurons` lote a lote e contado por dia UTC: a cota da Cloudflare zera
 * às 00:00 UTC, e contar pelo dia de `America/Sao_Paulo` punha as 21:00–24:00 de Brasília no dia
 * errado. Se a cota acabar mesmo assim (o reranker gasta da mesma conta), o adapter devolve
 * `EmbeddingQuotaExceededError` e o run para como `budget_exhausted`.
 */

/** Fuso do dia do orçamento: o da cota diária do Workers AI (00:00 UTC). */
const NEURON_BUDGET_TIME_ZONE = 'UTC'

export const DEFAULT_EMBED_NEURON_BUDGET = 8000

/** Medido no spike F1 (f): ≈ 1.075 neurons por milhão de tokens do BGE-M3. */
export const NEURONS_PER_MILLION_TOKENS = 1075

/** Estimativa conservadora (tokens = `ceil(chars/3)`), só para reservar o lote antes da chamada. */
export function estimateNeurons(texts: readonly string[]): number {
  const tokens = texts.reduce((sum, text) => sum + estimateTokens(text), 0)
  return Math.ceil((tokens * NEURONS_PER_MILLION_TOKENS) / 1_000_000)
}

export interface UsageReport {
  readonly neurons: number | null
  readonly texts: number
}

/** O que o medidor acumulou desde a última leitura. */
interface MeteredUsage {
  readonly neurons: number
  /** Textos de chamadas que voltaram sem custo informado (cobradas pela estimativa). */
  readonly unreportedTexts: number
}

/**
 * Medidor ligado ao `onUsage` do adapter de embeddings: o adapter registra o custo de cada
 * chamada, e o `EmbedPending` lê (e zera) o acumulado depois de cada lote.
 */
export interface NeuronMeter {
  record(usage: UsageReport): void
  take(): MeteredUsage
}

export function createNeuronMeter(): NeuronMeter {
  let neurons = 0
  let unreportedTexts = 0
  return {
    record(usage) {
      if (usage.neurons === null) {
        unreportedTexts += usage.texts
      } else {
        neurons += usage.neurons
      }
    },
    take() {
      const taken = { neurons, unreportedTexts }
      neurons = 0
      unreportedTexts = 0
      return taken
    },
  }
}

export interface NeuronBudget {
  /** Teto diário configurado. */
  readonly daily: number
  /** Neurons ainda disponíveis hoje (nunca negativo). */
  remaining(): Promise<number>
}

export function createNeuronBudget(deps: {
  readonly runs: IngestionRunRepository
  readonly clock: Clock
  readonly daily: number
  readonly timeZone?: string
}): NeuronBudget {
  if (!Number.isInteger(deps.daily) || deps.daily < 0) {
    throw new RangeError(`orçamento diário de neurons inválido: ${String(deps.daily)}`)
  }
  const timeZone = deps.timeZone ?? NEURON_BUDGET_TIME_ZONE
  return {
    daily: deps.daily,
    async remaining() {
      const today = isoDateInTimeZone(deps.clock.now(), timeZone)
      const spent = await deps.runs.neuronsSpentOn(today, timeZone)
      return Math.max(0, deps.daily - spent)
    },
  }
}
