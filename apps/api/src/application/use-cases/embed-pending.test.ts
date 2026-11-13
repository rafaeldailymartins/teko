import { describe, expect, it } from 'vitest'
import type { EmbeddingCache } from '../ports/embedding-cache.ts'
import {
  type EmbeddingPort,
  EmbeddingQuotaExceededError,
  EmbeddingUnavailableError,
} from '../ports/embedding-port.ts'
import type { IngestionRunRepository } from '../ports/ingestion-run-repository.ts'
import {
  createNeuronMeter,
  type NeuronBudget,
  type NeuronMeter,
} from '../services/neuron-budget.ts'
import {
  createEmbedPending,
  EmbeddingDimensionError,
  type EmbedPendingDeps,
  INGESTION_EMBEDDING_DIMENSIONS,
  type PendingText,
} from './embed-pending.ts'

const vector = (seed: number) => Array.from({ length: INGESTION_EMBEDDING_DIMENSIONS }, () => seed)

function memoryCache(initial: Record<string, number[]> = {}) {
  const store = new Map(Object.entries(initial))
  const puts: string[][] = []
  const cache: EmbeddingCache = {
    getMany: (hashes) =>
      Promise.resolve(
        new Map(
          hashes.flatMap((hash) => {
            const found = store.get(hash)
            return found === undefined ? [] : [[hash, found] as const]
          }),
        ),
      ),
    putMany: (entries) => {
      puts.push(entries.map((entry) => entry.hash))
      for (const entry of entries) {
        store.set(entry.hash, [...entry.vector])
      }
      return Promise.resolve()
    },
    retainOnly: () => Promise.reject(new Error('não usado')),
  }
  return { cache, store, puts }
}

function recordingRuns() {
  const added: number[] = []
  const fail = () => Promise.reject(new Error('não usado'))
  const runs: IngestionRunRepository = {
    start: fail,
    get: fail,
    finish: fail,
    neuronsSpentOn: fail,
    addNeurons: (_runId, neurons) => {
      added.push(neurons)
      return Promise.resolve()
    },
  }
  return { runs, added }
}

const budgetOf = (remaining: number): NeuronBudget & { calls: number } => {
  const budget = {
    daily: remaining,
    calls: 0,
    remaining: () => {
      budget.calls += 1
      return Promise.resolve(remaining)
    },
  }
  return budget
}

interface FakeProvider extends EmbeddingPort {
  readonly calls: string[][]
  maxInFlight: number
}

function provider(
  meter: NeuronMeter,
  options: {
    readonly neurons?: number | null
    readonly failures?: unknown[]
    readonly dimensions?: number
    readonly delayMs?: number
  } = {},
): FakeProvider {
  const failures = [...(options.failures ?? [])]
  let inFlight = 0
  const fake: FakeProvider = {
    model: 'modelo-teste',
    dimensions: INGESTION_EMBEDDING_DIMENSIONS,
    calls: [],
    maxInFlight: 0,
    async embed(texts) {
      fake.calls.push([...texts])
      inFlight += 1
      fake.maxInFlight = Math.max(fake.maxInFlight, inFlight)
      try {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 1))
        const failure = failures.shift()
        if (failure !== undefined) {
          throw failure
        }
        meter.record({
          neurons: options.neurons === undefined ? 1 : options.neurons,
          texts: texts.length,
        })
        return texts.map(() =>
          Array.from({ length: options.dimensions ?? INGESTION_EMBEDDING_DIMENSIONS }, () => 0.5),
        )
      } finally {
        inFlight -= 1
      }
    },
  }
  return fake
}

const texts = (n: number): PendingText[] =>
  Array.from({ length: n }, (_, index) => ({
    hash: `h${String(index)}`,
    text: `texto ${String(index)}`,
  }))

function setup(
  options: {
    readonly remaining?: number
    readonly cached?: Record<string, number[]>
    readonly neurons?: number | null
    readonly failures?: unknown[]
    readonly dimensions?: number
    readonly maxItems?: number
    readonly maxAttempts?: number
  } = {},
) {
  const meter = createNeuronMeter()
  const embeddings = provider(meter, options)
  const memory = memoryCache(options.cached)
  const recorded = recordingRuns()
  const budget = budgetOf(options.remaining ?? 1000)
  const sleeps: number[] = []
  const deps: EmbedPendingDeps = {
    embeddings,
    cache: memory.cache,
    runs: recorded.runs,
    budget,
    meter,
    batchLimits: { maxItems: options.maxItems ?? 1, maxPaddedTokens: 48_000 },
    ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
    sleep: (ms) => {
      sleeps.push(ms)
      return Promise.resolve()
    },
  }
  return { embed: createEmbedPending(deps), embeddings, memory, recorded, budget, sleeps }
}

describe('EmbedPending', () => {
  it('não chama o provedor nem o orçamento quando tudo já está no cache', async () => {
    const { embed, embeddings, budget } = setup({ cached: { h0: vector(1), h1: vector(2) } })
    const result = await embed({ runId: 'r', texts: texts(2) })
    expect(result).toEqual({ status: 'complete', neurons: 0, embedded: 0, cached: 2 })
    expect(embeddings.calls).toEqual([])
    expect(budget.calls).toBe(0)
  })

  it('embute só o que falta, um texto por hash, com concorrência 2 e commit por lote', async () => {
    const { embed, embeddings, memory, recorded } = setup({ cached: { h0: vector(1) } })
    const result = await embed({
      runId: 'r',
      texts: [...texts(6), { hash: 'h5', text: 'texto 5' }],
    })
    expect(result).toEqual({ status: 'complete', neurons: 5, embedded: 5, cached: 1 })
    expect(embeddings.calls.flat().sort()).toEqual([
      'texto 1',
      'texto 2',
      'texto 3',
      'texto 4',
      'texto 5',
    ])
    expect(embeddings.maxInFlight).toBe(2)
    expect(memory.puts).toHaveLength(5)
    expect(recorded.added).toEqual([1, 1, 1, 1, 1])
  })

  it('para antes do lote que não cabe no orçamento e informa o que ficou pendente', async () => {
    const { embed, embeddings, memory } = setup({ remaining: 2 })
    const result = await embed({ runId: 'r', texts: texts(5) })
    expect(result).toEqual({
      status: 'budget_exhausted',
      neurons: 2,
      embedded: 2,
      cached: 0,
      pending: 3,
    })
    expect(embeddings.calls).toHaveLength(2)
    expect(memory.store.size).toBe(2)
  })

  it('com orçamento zerado não chama o provedor', async () => {
    const { embed, embeddings } = setup({ remaining: 0 })
    const result = await embed({ runId: 'r', texts: texts(1) })
    expect(result).toMatchObject({ status: 'budget_exhausted', embedded: 0, pending: 1 })
    expect(embeddings.calls).toEqual([])
  })

  it('cobra a estimativa quando o provedor não informa o custo', async () => {
    const { embed, recorded } = setup({ neurons: null, maxItems: 10 })
    const result = await embed({ runId: 'r', texts: texts(3) })
    expect(result).toMatchObject({ status: 'complete', neurons: 1 })
    expect(recorded.added).toEqual([1])
  })

  it('não grava custo zero no run', async () => {
    const { embed, recorded } = setup({ neurons: 0 })
    await embed({ runId: 'r', texts: texts(2) })
    expect(recorded.added).toEqual([])
  })

  it('repete com backoff exponencial quando o provedor está indisponível', async () => {
    const unavailable = () => new EmbeddingUnavailableError('HTTP 429')
    const { embed, embeddings, sleeps } = setup({ failures: [unavailable(), unavailable()] })
    const result = await embed({ runId: 'r', texts: texts(1) })
    expect(result.status).toBe('complete')
    expect(embeddings.calls).toHaveLength(3)
    expect(sleeps).toEqual([1000, 2000])
  })

  it('desiste depois das tentativas e propaga o erro', async () => {
    const unavailable = () => new EmbeddingUnavailableError('fora do ar')
    const { embed, embeddings } = setup({
      failures: [unavailable(), unavailable(), unavailable()],
      maxAttempts: 3,
    })
    await expect(embed({ runId: 'r', texts: texts(2) })).rejects.toBeInstanceOf(
      EmbeddingUnavailableError,
    )
    expect(embeddings.calls).toHaveLength(3)
  })

  it('cota diária do provedor esgotada encerra como budget_exhausted, sem retry', async () => {
    const quota = new EmbeddingQuotaExceededError('3036')
    const { embed, embeddings, sleeps, memory } = setup({ failures: [undefined, quota] })
    // O primeiro lote passa; o segundo recebe o 429/3036 e nenhum lote novo começa.
    const result = await embed({ runId: 'r', texts: texts(6) })
    if (result.status !== 'budget_exhausted') {
      throw new Error('esperado budget_exhausted')
    }
    // Com concorrência 2, o lote vizinho ao que recebeu o 3036 ainda pode terminar.
    expect(result.embedded + result.pending).toBe(6)
    expect(result.embedded).toBeGreaterThanOrEqual(1)
    expect(result.embedded).toBeLessThanOrEqual(2)
    expect(sleeps).toEqual([])
    expect(embeddings.calls.length).toBeLessThanOrEqual(3)
    expect(memory.store.size).toBe(result.embedded)
  })

  it('cota esgotada já no primeiro lote não chama mais o provedor', async () => {
    const { embed, embeddings } = setup({ failures: [new EmbeddingQuotaExceededError('3036')] })
    const result = await embed({ runId: 'r', texts: texts(3) })
    expect(result).toMatchObject({ status: 'budget_exhausted', embedded: 0, pending: 3 })
    expect(embeddings.calls).toHaveLength(1)
  })

  it('não repete outros erros e não começa lotes novos depois de uma falha', async () => {
    const { embed, embeddings } = setup({ failures: [new TypeError('bug')] })
    await expect(embed({ runId: 'r', texts: texts(4) })).rejects.toBeInstanceOf(TypeError)
    expect(embeddings.calls).toHaveLength(1)
  })

  it('propaga a falha de um lote concorrente', async () => {
    const meter = createNeuronMeter()
    let call = 0
    const embeddings: EmbeddingPort = {
      model: 'm',
      dimensions: INGESTION_EMBEDDING_DIMENSIONS,
      embed: (batch) => {
        call += 1
        if (call === 3) {
          return Promise.reject(new RangeError('lote 3'))
        }
        meter.record({ neurons: 1, texts: batch.length })
        return Promise.resolve(batch.map(() => vector(0)))
      },
    }
    const embed = createEmbedPending({
      embeddings,
      cache: memoryCache().cache,
      runs: recordingRuns().runs,
      budget: budgetOf(100),
      meter,
      batchLimits: { maxItems: 1, maxPaddedTokens: 48_000 },
    })
    await expect(embed({ runId: 'r', texts: texts(6) })).rejects.toThrow('lote 3')
  })

  it('valida a dimensão dos vetores (1024)', async () => {
    const { embed, memory } = setup({ dimensions: 768 })
    await expect(embed({ runId: 'r', texts: texts(2) })).rejects.toBeInstanceOf(
      EmbeddingDimensionError,
    )
    expect(memory.store.size).toBe(0)
  })

  it('o backoff padrão espera de verdade', async () => {
    const meter = createNeuronMeter()
    let attempts = 0
    const embed = createEmbedPending({
      embeddings: {
        model: 'm',
        dimensions: INGESTION_EMBEDDING_DIMENSIONS,
        embed: (batch) => {
          attempts += 1
          if (attempts === 1) {
            return Promise.reject(new EmbeddingUnavailableError('instável'))
          }
          return Promise.resolve(batch.map(() => vector(0)))
        },
      },
      cache: memoryCache().cache,
      runs: recordingRuns().runs,
      budget: budgetOf(100),
      meter,
      baseDelayMs: 1,
      concurrency: 1,
    })
    expect(await embed({ runId: 'r', texts: texts(1) })).toMatchObject({ status: 'complete' })
    expect(attempts).toBe(2)
  })
})
