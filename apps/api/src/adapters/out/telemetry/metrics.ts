import type { Attributes, Meter } from '@opentelemetry/api'
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_HTTP_ROUTE,
  METRIC_HTTP_SERVER_REQUEST_DURATION,
} from '@opentelemetry/semantic-conventions'
import type { Telemetry } from '#app/ports/telemetry.ts'

/**
 * Único lugar que define os instrumentos de métrica da API (contrato com os painéis e alertas do
 * Grafana em `infra/grafana/` e com a tabela de `docs/architecture/observabilidade.md`). No Mimir,
 * os nomes OTel viram os do Prometheus: pontos por `_`, a unidade como sufixo e `_total` nos
 * counters (`teko.rag.answers` → `teko_rag_answers_total`). O ambiente (`deployment.environment.name`)
 * e o serviço vêm do resource, não dos atributos.
 *
 * Mudou um nome ou um atributo aqui, mude a tabela da arquitetura e os painéis no mesmo PR.
 */
export const MetricName = {
  HttpServerRequestDuration: METRIC_HTTP_SERVER_REQUEST_DURATION,
  RagAnswers: 'teko.rag.answers',
  RagCitationsInvalidated: 'teko.rag.citations_invalidated',
  RagInsufficientSentinel: 'teko.rag.insufficient_sentinel',
  RagRerankerScore: 'teko.rag.reranker_score',
  LlmTtft: 'teko.llm.ttft',
  LlmTokens: 'teko.llm.tokens',
  LlmShadowCost: 'teko.llm.shadow_cost',
  LlmProviderErrors: 'teko.llm.provider_errors',
  LlmProviderFallback: 'teko.llm.provider_fallback',
  QuotaUsedRatio: 'teko.quota.used_ratio',
} as const

/** Buckets da semconv HTTP (segundos). */
const HTTP_DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
]
/** TTFT: o alerta é p95 > 3 s. */
const TTFT_BUCKETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10, 20]
/** Nota do reranker (BGE, 0 a 1). */
const RERANKER_SCORE_BUCKETS = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]

/** Posições do reranker: a nota do primeiro e a de cada um dos devolvidos (até 12). */
const RerankRank = { Top1: 'top1', Top12: 'top12' } as const

function withCorpusVersion(attributes: Attributes, corpusVersion: number | null): Attributes {
  return corpusVersion === null ? attributes : { ...attributes, corpus_version: corpusVersion }
}

/** Porta `Telemetry` sobre um `Meter` do OTel (o do `MeterProvider` do SDK, ou um de teste). */
export function createOtelTelemetry(meter: Meter): Telemetry {
  const httpDuration = meter.createHistogram(MetricName.HttpServerRequestDuration, {
    unit: 's',
    description: 'Duração das requisições HTTP da API',
    advice: { explicitBucketBoundaries: HTTP_DURATION_BUCKETS },
  })
  const answers = meter.createCounter(MetricName.RagAnswers, {
    description: 'Perguntas terminadas, por desfecho e motivo de recusa',
  })
  const citationsInvalidated = meter.createCounter(MetricName.RagCitationsInvalidated, {
    description: 'Citações a fontes inexistentes removidas pelo CitationValidator',
  })
  const insufficient = meter.createCounter(MetricName.RagInsufficientSentinel, {
    description: 'Respostas do modelo com o sentinel INSUFICIENTE',
  })
  const rerankerScore = meter.createHistogram(MetricName.RagRerankerScore, {
    description: 'Nota do reranker no top-1 e no top-12',
    advice: { explicitBucketBoundaries: RERANKER_SCORE_BUCKETS },
  })
  const ttft = meter.createHistogram(MetricName.LlmTtft, {
    unit: 's',
    description: 'Tempo até o primeiro token do LLM',
    advice: { explicitBucketBoundaries: TTFT_BUCKETS },
  })
  const tokens = meter.createCounter(MetricName.LlmTokens, {
    description: 'Tokens de entrada e de saída por modelo',
  })
  const shadowCost = meter.createCounter(MetricName.LlmShadowCost, {
    unit: 'USD',
    description: 'Custo-sombra a preço de tabela (o faturado é 0)',
  })
  const providerErrors = meter.createCounter(MetricName.LlmProviderErrors, {
    description: 'Falhas dos provedores de LLM por status',
  })
  const providerFallback = meter.createCounter(MetricName.LlmProviderFallback, {
    description: 'Fallbacks da cadeia de LLM antes do primeiro token',
  })
  const quotaUsedRatio = meter.createGauge(MetricName.QuotaUsedRatio, {
    description: 'Uso da cota diária global sobre o teto',
  })

  return {
    httpRequest({ method, route, statusCode, durationSeconds }) {
      httpDuration.record(durationSeconds, {
        [ATTR_HTTP_REQUEST_METHOD]: method,
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: statusCode,
        ...(route === null ? {} : { [ATTR_HTTP_ROUTE]: route }),
      })
    },
    answer({ outcome, refusalReason, retrievalMode, cached, corpusVersion }) {
      answers.add(
        1,
        withCorpusVersion(
          {
            outcome,
            cached,
            ...(refusalReason === null ? {} : { refusal_reason: refusalReason }),
            ...(retrievalMode === null ? {} : { retrieval_mode: retrievalMode }),
          },
          corpusVersion,
        ),
      )
    },
    citationsInvalidated(count, corpusVersion) {
      citationsInvalidated.add(count, withCorpusVersion({}, corpusVersion))
    },
    insufficientSentinel(corpusVersion) {
      insufficient.add(1, withCorpusVersion({}, corpusVersion))
    },
    rerankerScores(scores) {
      const [top1] = scores
      if (top1 === undefined) {
        return
      }
      rerankerScore.record(top1, { rank: RerankRank.Top1 })
      for (const score of scores) {
        rerankerScore.record(score, { rank: RerankRank.Top12 })
      }
    },
    llmCall({ provider, model, ttftSeconds, inputTokens, outputTokens, shadowCostUsd }) {
      const attributes = { provider, model }
      if (ttftSeconds !== null) {
        ttft.record(ttftSeconds, attributes)
      }
      tokens.add(inputTokens, { ...attributes, type: 'input' })
      tokens.add(outputTokens, { ...attributes, type: 'output' })
      shadowCost.add(shadowCostUsd, attributes)
    },
    providerError(provider, status) {
      providerErrors.add(1, { provider, status })
    },
    providerFallback(from, to) {
      providerFallback.add(1, { from, to })
    },
    quotaUsage(usages) {
      for (const { scope, ratio } of usages) {
        quotaUsedRatio.record(ratio, { scope })
      }
    },
  }
}
