import { isLangfuseSpan, LangfuseSpanProcessor } from '@langfuse/otel'
import { LangfuseOtelSpanAttributes, startObservation } from '@langfuse/tracing'
import type { Attributes } from '@opentelemetry/api'
import type { SpanExporter, SpanProcessor } from '@opentelemetry/sdk-trace-node'
import type { Citation } from '@teko/shared/contracts'
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
import { GENERATION_NAMES, QUERY_TRACE_NAME, RETRIEVAL_OBSERVATION_NAME } from './langfuse-names.ts'
import { langfuseUserId } from './langfuse-user.ts'

/**
 * Langfuse sobre o mesmo `NodeTracerProvider` do OTel (`docs/architecture/observabilidade.md`):
 *
 * - `createLangfuseSpanProcessor`: o `LangfuseSpanProcessor` que `src/instrumentation.ts` devolve
 *   em `additionalSpanProcessors`. Exporta **só** os spans do SDK do Langfuse (escopo
 *   `langfuse-sdk`), que só existem nos traces que o `TraceSampler` amostrou; os spans `chat
 *   <modelo>` (`gen_ai.*`) ficam só no Grafana, porque a generation `generate-answer` já leva o
 *   modelo, o uso, o custo e o TTFT (exportar os dois duplicaria tokens e custo e gastaria mais
 *   units). O `mask` passa o `PiiRedactor` (`redact` de `@teko/shared/pii`) em entrada, saída e
 *   metadata, como segunda barreira (a pergunta já chega redigida). Exportação em lote, sem upload
 *   de mídia, alcançada pelo flush por requisição.
 * - `createLangfuseTracing`: a porta `LlmTracingPort`, com as observations do trace
 *   `answer-question` criadas por `@langfuse/tracing` (o tracer vem do provider global, o mesmo do
 *   Grafana), nomeadas e montadas pelas boas práticas do Langfuse
 *   (https://langfuse.com/docs/observability/best-practices): verbo no início, a pergunta e a
 *   resposta na raiz, o retriever com a consulta e os itens, as generations com mensagens no
 *   formato OpenAI e o raciocínio do modelo, e os atributos de correlação (usuário, sessão, tags e
 *   metadata do trace) em toda observation.
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

const at = (ms: number): Date => new Date(ms)

/**
 * Atributos de correlação do trace, repetidos em toda observation (o modelo do Langfuse v4 filtra
 * as observations por eles sem juntar com o trace). Vão direto nos spans: as filhas são criadas
 * fora do contexto assíncrono da raiz (o stream), e o `propagateAttributes` não as alcançaria. A
 * metadata do trace leva só strings curtas, como no `propagateAttributes`; a versão do prompt fica
 * no `version` de cada observation (a da reescrita é outra).
 */
function traceAttributes(start: QueryTraceStart): Attributes {
  const metadata: Readonly<Record<string, string>> = {
    question_id: start.questionId,
    reference_date: start.referenceDate,
    reference_source: start.referenceSource,
    corpus_version: String(start.corpusVersion ?? -1),
    cached: String(start.cached),
    locale: start.locale,
  }
  return {
    [LangfuseOtelSpanAttributes.TRACE_NAME]: QUERY_TRACE_NAME,
    [LangfuseOtelSpanAttributes.TRACE_USER_ID]: langfuseUserId(start.userId),
    [LangfuseOtelSpanAttributes.TRACE_SESSION_ID]: start.conversationId,
    [LangfuseOtelSpanAttributes.TRACE_TAGS]: [start.cached ? 'cache' : 'llm', start.locale],
    ...Object.fromEntries(
      Object.entries(metadata).map(([key, value]) => [
        `${LangfuseOtelSpanAttributes.TRACE_METADATA}.${key}`,
        value,
      ]),
    ),
  }
}

/** Contexto da pergunta na metadata da raiz (o que não é a pergunta nem a resposta). */
function rootStartMetadata(start: QueryTraceStart) {
  return {
    question_id: start.questionId,
    reference_date: start.referenceDate,
    reference_source: start.referenceSource,
    families: [...start.families],
    locale: start.locale,
    corpus_version: start.corpusVersion,
    cached: start.cached,
  }
}

/** Citação usada na resposta: o que um evaluator de fidelidade compara com o texto. */
function citationMetadata(citation: Citation) {
  return {
    id: citation.id,
    label: citation.label,
    stableKey: citation.stableKey,
    document: `${citation.document.title} — ${citation.document.versionLabel}`,
    validity: citation.validity,
    excerpt: citation.excerpt ?? null,
  }
}

/**
 * Citações na metadata da raiz: as usadas na resposta, com o trecho, e só os ids das fontes que
 * foram ao prompt e não foram citadas (o texto delas está na entrada da generation).
 */
function citationsMetadata(citations: QueryTraceEnd['citations']) {
  const cited = citations.filter((citation) => citation.valid)
  return {
    citations: cited.map(citationMetadata),
    uncited_sources: citations.filter((citation) => !citation.valid).map((citation) => citation.id),
  }
}

/** Nível e mensagem do desfecho: falha é erro, desconexão é aviso, recusa leva o motivo. */
function outcomeStatus(result: QueryTraceEnd) {
  if (result.outcome === 'failed') {
    return { level: 'ERROR' as const, statusMessage: result.failure ?? 'failed' }
  }
  if (result.outcome === 'aborted') {
    return { level: 'WARNING' as const, statusMessage: 'aborted' }
  }
  return result.refusalReason === null ? {} : { statusMessage: result.refusalReason }
}

function retrievalUpdate(summary: RetrievalSummary) {
  const count = (rank: (item: RetrievalSummary['items'][number]) => number | null): number =>
    summary.items.filter((item) => rank(item) !== null).length
  return {
    input: {
      query: summary.query,
      rewrittenQuery: summary.rewrittenQuery,
      referenceDate: summary.referenceDate,
      families: [...summary.families],
    },
    output: summary.items,
    metadata: {
      retrieval_mode: summary.mode,
      top_k: summary.items.length,
      candidates_by_channel: {
        lexical: count((item) => item.lexicalRank),
        semantic: count((item) => item.semanticRank),
        reference: count((item) => item.referenceRank),
      },
      reranked: summary.reranked,
      rewritten: summary.rewrittenQuery !== null,
      uncovered_families: [...summary.uncoveredFamilies],
      refusal_reason: summary.refusalReason,
    },
    ...(summary.refusalReason === null ? {} : { statusMessage: summary.refusalReason }),
  }
}

/**
 * Saída da generation no formato que o Langfuse desenha como conversa: a mensagem do assistente
 * e, quando o modelo devolveu raciocínio, um item `reasoning` antes dela (formato da Responses API
 * da OpenAI, que a interface mostra como bloco "Thinking").
 */
function generationOutput(result: GenerationEnd) {
  const message =
    result.output === null ? null : { role: 'assistant' as const, content: result.output }
  if (result.reasoning === null) {
    return message
  }
  const reasoning = {
    type: 'reasoning' as const,
    content: [{ type: 'reasoning_text' as const, text: result.reasoning }],
  }
  return { output: message === null ? [reasoning] : [reasoning, message] }
}

function generationUpdate(start: GenerationStart, result: GenerationEnd) {
  const ttftMs = result.firstTokenAtMs
  const output = generationOutput(result)
  return {
    ...(output === null ? {} : { output }),
    usageDetails: {
      input: result.usage.inputTokens,
      output: result.usage.outputTokens,
      total: result.usage.inputTokens + result.usage.outputTokens,
    },
    costDetails: { ...result.cost },
    ...(ttftMs === null ? {} : { completionStartTime: at(ttftMs) }),
    level: result.error === null ? ('DEFAULT' as const) : ('ERROR' as const),
    ...(result.error === null ? {} : { statusMessage: result.error }),
    metadata: {
      provider: start.provider,
      billed_usd: 0,
      ttft_ms: ttftMs === null ? null : ttftMs - start.startedAtMs,
    },
  }
}

function startQuery(start: QueryTraceStart): QueryObservations {
  const correlation = traceAttributes(start)
  const root = startObservation(
    QUERY_TRACE_NAME,
    { input: start.question, metadata: rootStartMetadata(start), version: start.promptVersion },
    { startTime: at(start.startedAtMs) },
  )
  root.otelSpan.setAttributes(correlation)
  const parentSpanContext = root.otelSpan.spanContext()

  return {
    traceId: root.traceId,
    retrieval(startedAtMs) {
      const span = startObservation(
        RETRIEVAL_OBSERVATION_NAME,
        {},
        { asType: 'retriever', startTime: at(startedAtMs), parentSpanContext },
      )
      span.otelSpan.setAttributes(correlation)
      return {
        end(summary, endedAtMs) {
          span.update(retrievalUpdate(summary))
          span.end(at(endedAtMs))
        },
      }
    },
    generation(generation: GenerationStart) {
      const span = startObservation(
        GENERATION_NAMES[generation.purpose],
        {
          model: generation.model,
          input: [
            { role: 'system', content: generation.system },
            { role: 'user', content: generation.prompt },
          ],
          modelParameters: {
            temperature: generation.temperature,
            maxOutputTokens: generation.maxOutputTokens,
          },
          version: generation.promptVersion,
          // O faturado é sempre 0 (free tier); o `costDetails` é o preço de tabela.
          metadata: { provider: generation.provider, billed_usd: 0 },
        },
        { asType: 'generation', startTime: at(generation.startedAtMs), parentSpanContext },
      )
      span.otelSpan.setAttributes(correlation)
      return {
        end(result) {
          span.update(generationUpdate(generation, result))
          span.end(at(result.endedAtMs))
        },
      }
    },
    end(result: QueryTraceEnd) {
      root.update({
        ...(result.answer === null ? {} : { output: result.answer }),
        metadata: {
          outcome: result.outcome,
          refusal_reason: result.refusalReason,
          corpus_version: result.corpusVersion,
          ...citationsMetadata(result.citations),
        },
        ...outcomeStatus(result),
      })
      root.end(at(result.endedAtMs))
    },
  }
}

export function createLangfuseTracing(): LlmTracingPort {
  return { startQuery }
}
