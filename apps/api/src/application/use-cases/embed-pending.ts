import type { EmbeddingCache } from '../ports/embedding-cache.ts'
import {
  type EmbeddingPort,
  EmbeddingQuotaExceededError,
  EmbeddingUnavailableError,
} from '../ports/embedding-port.ts'
import type { IngestionRunRepository } from '../ports/ingestion-run-repository.ts'
import { type BatchLimits, planEmbeddingBatches } from '../services/embedding-batches.ts'
import { estimateNeurons, type NeuronBudget, type NeuronMeter } from '../services/neuron-budget.ts'

/**
 * `EmbedPending`: garante no `embedding_cache` o vetor de cada texto de embedding pedido. O cache é
 * o checkpoint: o que já está nele custa 0 neurons; o resto vai ao provedor em lotes de
 * `planEmbeddingBatches` (50 itens e o teto de tokens preenchidos), com concorrência 2 e backoff
 * exponencial quando o provedor falha. Cada lote é gravado no cache e somado ao run (custo real do
 * `onUsage`) antes do próximo, fora de qualquer transação de versão de documento.
 *
 * O primeiro lote roda sozinho e valida a dimensão (1024, BGE-M3). Antes de cada lote, a estimativa
 * conservadora é reservada contra o orçamento diário; se não couber, nenhum lote novo começa e o
 * resultado é `budget_exhausted` (o CLI sai com 75 e o run seguinte retoma pelo cache). A cota
 * diária do provedor esgotada (`EmbeddingQuotaExceededError`) tem o mesmo efeito, sem retry.
 */

/** Dimensão exigida dos vetores (BGE-M3; `halfvec(1024)` no schema). */
export const INGESTION_EMBEDDING_DIMENSIONS = 1024
const DEFAULT_CONCURRENCY = 2
const DEFAULT_MAX_ATTEMPTS = 4
const DEFAULT_BASE_DELAY_MS = 1000

export interface PendingText {
  /** `ContentHasher.hash(text)`: a chave do cache. */
  readonly hash: string
  readonly text: string
}

interface EmbedPendingCommand {
  readonly runId: string
  readonly texts: readonly PendingText[]
}

interface EmbedTotals {
  /** Neurons cobrados nesta chamada. */
  readonly neurons: number
  /** Textos embutidos agora. */
  readonly embedded: number
  /** Textos que já estavam no cache. */
  readonly cached: number
}

export type EmbedPendingResult =
  | (EmbedTotals & { readonly status: 'complete' })
  | (EmbedTotals & { readonly status: 'budget_exhausted'; readonly pending: number })

export type EmbedPending = (command: EmbedPendingCommand) => Promise<EmbedPendingResult>

export interface EmbedPendingDeps {
  readonly embeddings: EmbeddingPort
  readonly cache: EmbeddingCache
  readonly runs: IngestionRunRepository
  readonly budget: NeuronBudget
  readonly meter: NeuronMeter
  readonly batchLimits?: BatchLimits
  readonly concurrency?: number
  readonly maxAttempts?: number
  readonly baseDelayMs?: number
  /** Injetável nos testes (o padrão é um `setTimeout`). */
  readonly sleep?: (ms: number) => Promise<void>
}

export class EmbeddingDimensionError extends Error {
  constructor(received: number) {
    super(
      `o provedor de embeddings devolveu vetor com ${String(received)} dimensões (esperado: ${String(INGESTION_EMBEDDING_DIMENSIONS)})`,
    )
    this.name = 'EmbeddingDimensionError'
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

function uniqueByHash(texts: readonly PendingText[]): PendingText[] {
  const byHash = new Map<string, PendingText>()
  for (const entry of texts) {
    byHash.set(entry.hash, entry)
  }
  return [...byHash.values()]
}

/** Estado compartilhado pelos workers de uma chamada. */
interface BatchState {
  /** Orçamento do dia ainda não gasto (lido uma vez por chamada). */
  available: number
  /** Estimativas dos lotes em voo. */
  reserved: number
  neurons: number
  embedded: number
  exhausted: boolean
  failure: { readonly error: unknown } | null
  next: number
}

export function createEmbedPending(deps: EmbedPendingDeps): EmbedPending {
  const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const baseDelayMs = deps.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const sleep = deps.sleep ?? defaultSleep
  const model = deps.embeddings.model

  async function embedWithRetry(texts: readonly string[]): Promise<number[][]> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await deps.embeddings.embed(texts)
      } catch (error) {
        if (
          !(error instanceof EmbeddingUnavailableError) ||
          error instanceof EmbeddingQuotaExceededError ||
          attempt >= maxAttempts
        ) {
          throw error
        }
        await sleep(baseDelayMs * 2 ** (attempt - 1))
      }
    }
  }

  return async ({ runId, texts }) => {
    const unique = uniqueByHash(texts)
    const cachedVectors = await deps.cache.getMany(
      unique.map((entry) => entry.hash),
      model,
    )
    const missing = unique.filter((entry) => !cachedVectors.has(entry.hash))
    const cached = unique.length - missing.length
    const batches = planEmbeddingBatches(
      missing.map((entry) => entry.text),
      deps.batchLimits,
    ).map((indexes) =>
      indexes.map((index) => missing[index]).filter((entry) => entry !== undefined),
    )

    const state: BatchState = {
      available: batches.length === 0 ? 0 : await deps.budget.remaining(),
      reserved: 0,
      neurons: 0,
      embedded: 0,
      exhausted: false,
      failure: null,
      next: 0,
    }

    const runBatch = async (batch: readonly PendingText[]): Promise<void> => {
      const batchTexts = batch.map((entry) => entry.text)
      const estimate = estimateNeurons(batchTexts)
      state.reserved += estimate
      try {
        const vectors = await embedWithRetry(batchTexts)
        const entries = batch.map((entry, index) => {
          const vector = vectors[index]
          if (vector?.length !== INGESTION_EMBEDDING_DIMENSIONS) {
            throw new EmbeddingDimensionError(vector?.length ?? 0)
          }
          return { hash: entry.hash, vector }
        })
        await deps.cache.putMany(entries, model)
        const usage = deps.meter.take()
        const cost = usage.neurons + (usage.unreportedTexts > 0 ? estimate : 0)
        if (cost > 0) {
          await deps.runs.addNeurons(runId, cost)
        }
        state.available -= cost
        state.neurons += cost
        state.embedded += batch.length
      } finally {
        state.reserved -= estimate
      }
    }

    /** Próximo lote que cabe no orçamento, ou `undefined` (fim, falha ou orçamento esgotado). */
    const take = (): readonly PendingText[] | undefined => {
      const batch = batches[state.next]
      if (batch === undefined || state.failure !== null || state.exhausted) {
        return undefined
      }
      if (estimateNeurons(batch.map((entry) => entry.text)) > state.available - state.reserved) {
        state.exhausted = true
        return undefined
      }
      state.next += 1
      return batch
    }

    /** Cota do provedor esgotada encerra como orçamento esgotado; o resto é falha. */
    const fail = (error: unknown): void => {
      if (error instanceof EmbeddingQuotaExceededError) {
        state.exhausted = true
      } else {
        state.failure ??= { error }
      }
    }

    const worker = async (): Promise<void> => {
      for (let batch = take(); batch !== undefined; batch = take()) {
        try {
          await runBatch(batch)
        } catch (error) {
          fail(error)
        }
      }
    }

    // O primeiro lote sozinho valida a dimensão antes de a concorrência começar.
    const first = take()
    if (first !== undefined) {
      try {
        await runBatch(first)
      } catch (error) {
        fail(error)
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()))
    if (state.failure !== null) {
      throw state.failure.error
    }
    const totals = { neurons: state.neurons, embedded: state.embedded, cached }
    return state.exhausted
      ? { ...totals, status: 'budget_exhausted', pending: missing.length - state.embedded }
      : { ...totals, status: 'complete' }
  }
}
