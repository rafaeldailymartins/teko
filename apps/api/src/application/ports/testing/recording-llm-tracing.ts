import type {
  GenerationEnd,
  GenerationStart,
  LlmTracingPort,
  QueryTraceEnd,
  QueryTraceStart,
  RetrievalSummary,
  TraceFeedback,
  TraceFeedbackPort,
} from '../llm-tracing.ts'

/** Uma pergunta rastreada, com tudo o que o caso de uso pediu ao adapter. */
export interface RecordedQuery {
  readonly traceId: string
  readonly start: QueryTraceStart
  readonly retrievals: {
    readonly startedAtMs: number
    summary: RetrievalSummary | null
    endedAtMs: number | null
  }[]
  readonly generations: { readonly start: GenerationStart; end: GenerationEnd | null }[]
  end: QueryTraceEnd | null
}

/** `LlmTracingPort` em memória para os testes dos casos de uso. */
export function recordingLlmTracing(): LlmTracingPort & { readonly queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = []
  return {
    queries,
    startQuery(start) {
      const query: RecordedQuery = {
        traceId: `trace-${String(queries.length + 1)}`,
        start,
        retrievals: [],
        generations: [],
        end: null,
      }
      queries.push(query)
      return {
        traceId: query.traceId,
        retrieval(startedAtMs) {
          const entry = {
            startedAtMs,
            summary: null as RetrievalSummary | null,
            endedAtMs: null as number | null,
          }
          query.retrievals.push(entry)
          return {
            end(summary, endedAtMs) {
              entry.summary = summary
              entry.endedAtMs = endedAtMs
            },
          }
        },
        generation(generation) {
          const entry = { start: generation, end: null as GenerationEnd | null }
          query.generations.push(entry)
          return {
            end(result) {
              entry.end = result
            },
          }
        },
        end(result) {
          query.end = result
        },
      }
    },
  }
}

/** `TraceFeedbackPort` em memória; `fail` faz a próxima chamada rejeitar. */
export function recordingTraceFeedback(): TraceFeedbackPort & {
  readonly calls: TraceFeedback[]
  fail: boolean
} {
  const port = {
    calls: [] as TraceFeedback[],
    fail: false,
    recordFeedback(feedback: TraceFeedback): Promise<void> {
      port.calls.push(feedback)
      return port.fail ? Promise.reject(new Error('langfuse fora')) : Promise.resolve()
    },
  }
  return port
}
