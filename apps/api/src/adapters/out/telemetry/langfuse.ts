import { isLangfuseSpan, LangfuseSpanProcessor } from '@langfuse/otel'
import { LangfuseOtelSpanAttributes, startObservation } from '@langfuse/tracing'
import type { SpanExporter, SpanProcessor } from '@opentelemetry/sdk-trace-node'
import { redact } from '@teko/shared/pii'
import type {
  GenerationEnd,
  GenerationStart,
  LlmTracingPort,
  QueryObservations,
  QueryTraceEnd,
  QueryTraceStart,
  RetrievalSummary,
} from '#app/ports/llm-tracing.ts'
import { langfuseUserId } from './langfuse-user.ts'

/**
 * Langfuse sobre o mesmo `NodeTracerProvider` do OTel (`docs/architecture/observabilidade.md`):
 *
 * - `createLangfuseSpanProcessor`: o `LangfuseSpanProcessor` que `src/instrumentation.ts` devolve
 *   em `additionalSpanProcessors`. Exporta **só** os spans do SDK do Langfuse (escopo
 *   `langfuse-sdk`), que só existem nos traces que o `TraceSampler` amostrou; os spans `chat
 *   <modelo>` (`gen_ai.*`) ficam só no Grafana, porque a generation `answer` já leva o modelo, o
 *   uso, o custo e o TTFT (exportar os dois duplicaria tokens e custo e gastaria mais units). O
 *   `mask` passa o `PiiRedactor` (`redact` de `@teko/shared/pii`) em entrada, saída e metadata,
 *   como segunda barreira (a pergunta já chega redigida). Exportação em lote, sem upload de mídia,
 *   alcançada pelo flush por requisição.
 * - `createLangfuseTracing`: a porta `LlmTracingPort`, com as observations do trace `rag-query`
 *   criadas por `@langfuse/tracing` (o tracer vem do provider global, o mesmo do Grafana).
 */

export interface LangfuseProcessorConfig {
  readonly publicKey: string
  readonly secretKey: string
  readonly baseUrl: string
  /** `langfuse.environment` (`LANGFUSE_TRACING_ENVIRONMENT`, padrão o `APP_ENV`). */
  readonly environment: string
  /** `langfuse.release` (`LANGFUSE_RELEASE`, padrão o commit). */
  readonly release: string
  /** Exporter no lugar do OTLP do Langfuse (testes, com o exporter em memória do SDK). */
  readonly exporter?: SpanExporter
}

/** Teto da exportação (s): a tarefa pós-resposta do flush tem 500 ms. */
const EXPORT_TIMEOUT_S = 1

/** Redige PII em qualquer string do valor (recursivo em listas e objetos). */
export function maskPii(data: unknown): unknown {
  if (typeof data === 'string') {
    return redact(data).text
  }
  if (Array.isArray(data)) {
    return data.map(maskPii)
  }
  if (data !== null && typeof data === 'object') {
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, maskPii(value)]))
  }
  return data
}

export function createLangfuseSpanProcessor(config: LangfuseProcessorConfig): SpanProcessor {
  return new LangfuseSpanProcessor({
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    baseUrl: config.baseUrl,
    environment: config.environment,
    release: config.release,
    mask: ({ data }) => maskPii(data),
    shouldExportSpan: ({ otelSpan }) => isLangfuseSpan(otelSpan),
    mediaUploadEnabled: false,
    exportMode: 'batched',
    timeout: EXPORT_TIMEOUT_S,
    ...(config.exporter === undefined ? {} : { exporter: config.exporter }),
  })
}

const RAG_QUERY_TRACE = 'rag-query'

const at = (ms: number): Date => new Date(ms)

function retrievalOutput(summary: RetrievalSummary) {
  return {
    retrievalMode: summary.mode,
    topK: summary.topK,
    candidatesByChannel: summary.candidatesByChannel,
    rrf: summary.rrf,
    reranked: summary.reranked,
    rewritten: summary.rewritten,
    uncoveredFamilies: summary.uncoveredFamilies,
    refusalReason: summary.refusalReason,
  }
}

function generationUpdate(result: GenerationEnd) {
  const ttftMs = result.firstTokenAtMs
  return {
    output: result.output,
    usageDetails: {
      input: result.usage.inputTokens,
      output: result.usage.outputTokens,
      total: result.usage.inputTokens + result.usage.outputTokens,
    },
    costDetails: { ...result.cost },
    ...(ttftMs === null ? {} : { completionStartTime: at(ttftMs) }),
    level: result.error === null ? ('DEFAULT' as const) : ('ERROR' as const),
    ...(result.error === null ? {} : { statusMessage: result.error }),
  }
}

function traceMetadata(start: QueryTraceStart): Record<string, string | number | boolean> {
  return {
    question_id: start.questionId,
    reference_date: start.referenceDate,
    reference_source: start.referenceSource,
    corpus_version: start.corpusVersion ?? -1,
    prompt_version: start.promptVersion,
    cached: start.cached,
  }
}

function startQuery(start: QueryTraceStart): QueryObservations {
  const root = startObservation(
    RAG_QUERY_TRACE,
    {
      input: {
        question: start.question,
        referenceDate: start.referenceDate,
        referenceSource: start.referenceSource,
        locale: start.locale,
        families: [...start.families],
      },
      metadata: traceMetadata(start),
      version: start.promptVersion,
    },
    { startTime: at(start.startedAtMs) },
  )
  // Atributos do trace direto na raiz: as observations filhas são criadas fora do contexto
  // assíncrono dela (o stream), então o `propagateAttributes` não as alcançaria.
  const metadata = Object.fromEntries(
    Object.entries(traceMetadata(start)).map(([key, value]) => [
      `${LangfuseOtelSpanAttributes.TRACE_METADATA}.${key}`,
      JSON.stringify(value),
    ]),
  )
  root.otelSpan.setAttributes({
    [LangfuseOtelSpanAttributes.TRACE_NAME]: RAG_QUERY_TRACE,
    [LangfuseOtelSpanAttributes.TRACE_USER_ID]: langfuseUserId(start.userId),
    [LangfuseOtelSpanAttributes.TRACE_TAGS]: [start.cached ? 'cache' : 'llm', start.locale],
    ...metadata,
  })
  const parentSpanContext = root.otelSpan.spanContext()

  return {
    traceId: root.traceId,
    retrieval(startedAtMs) {
      const span = startObservation(
        'retrieval',
        {},
        { asType: 'retriever', startTime: at(startedAtMs), parentSpanContext },
      )
      return {
        end(summary, endedAtMs) {
          span.update({ output: retrievalOutput(summary) })
          span.end(at(endedAtMs))
        },
      }
    },
    generation(generation: GenerationStart) {
      const span = startObservation(
        generation.name,
        {
          model: generation.model,
          input: generation.input,
          modelParameters: {
            temperature: generation.temperature,
            maxOutputTokens: generation.maxOutputTokens,
          },
          // O faturado é sempre 0 (free tier); o `costDetails` é o preço de tabela.
          metadata: { provider: generation.provider, billed_usd: 0 },
        },
        { asType: 'generation', startTime: at(generation.startedAtMs), parentSpanContext },
      )
      return {
        end(result) {
          span.update({
            ...generationUpdate(result),
            metadata: {
              provider: generation.provider,
              billed_usd: 0,
              ttft_ms:
                result.firstTokenAtMs === null
                  ? null
                  : result.firstTokenAtMs - generation.startedAtMs,
            },
          })
          span.end(at(result.endedAtMs))
        },
      }
    },
    end(result: QueryTraceEnd) {
      root.update({
        output: {
          outcome: result.outcome,
          refusalReason: result.refusalReason,
          answer: result.answer,
          citations: result.citations,
        },
        metadata: { ...traceMetadata(start), corpus_version: result.corpusVersion ?? -1 },
        level: result.outcome === 'failed' ? 'ERROR' : 'DEFAULT',
      })
      root.end(at(result.endedAtMs))
    },
  }
}

export function createLangfuseTracing(): LlmTracingPort {
  return { startQuery }
}
