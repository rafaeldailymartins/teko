import { z } from 'zod'
import { RefusalReason, RetrievalMode } from '../contracts/common.ts'
import { FeedbackRating, FeedbackReason } from '../contracts/questions.ts'
import { QuotaScope } from '../errors/codes.ts'
import { LOCALES } from '../i18n/locales.ts'
import { ReferenceSource } from '../vigencia/reference-date.ts'

/**
 * Catálogo tipado dos eventos do PostHog. Regras:
 * - o texto da pergunta (ou qualquer texto livre) NUNCA é enviado;
 * - toda propriedade é um enum, booleano, número ou identificador técnico;
 * - os schemas são estritos, então uma propriedade fora do catálogo é rejeitada.
 */

/** Faixas de latência até o fim da resposta (`answer_completed.latency_bucket`). */
export const LatencyBucket = {
  Under1s: 'lt_1s',
  From1To3s: '1s_3s',
  From3To10s: '3s_10s',
  From10To30s: '10s_30s',
  Over30s: 'gte_30s',
} as const
export type LatencyBucket = (typeof LatencyBucket)[keyof typeof LatencyBucket]

export function latencyBucket(milliseconds: number): LatencyBucket {
  if (milliseconds < 1000) {
    return LatencyBucket.Under1s
  }
  if (milliseconds < 3000) {
    return LatencyBucket.From1To3s
  }
  if (milliseconds < 10_000) {
    return LatencyBucket.From3To10s
  }
  return milliseconds < 30_000 ? LatencyBucket.From10To30s : LatencyBucket.Over30s
}

const localeSchema = z.enum(LOCALES)
/** Identificador técnico curto (família de modelo, id de modelo, tipo de documento). */
const technicalId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._/-]*$/)
  .max(64)
/** `trace_id` W3C (32 hex), a mesma correlação usada no Sentry e no Langfuse. */
const traceId = z.string().regex(/^[0-9a-f]{32}$/)

export const ANALYTICS_EVENTS = {
  question_asked: z.strictObject({
    locale: localeSchema,
    reference_source: z.enum(ReferenceSource),
  }),
  reference_date_set: z.strictObject({ source: z.enum(ReferenceSource) }),
  clarification_shown: z.strictObject({}),
  answer_completed: z.strictObject({
    model_family: technicalId,
    cached: z.boolean(),
    retrieval_mode: z.enum(RetrievalMode),
    latency_bucket: z.enum(LatencyBucket),
    trace_id: traceId.optional(),
  }),
  answer_refused: z.strictObject({
    reason: z.enum(RefusalReason),
    trace_id: traceId.optional(),
  }),
  citation_opened: z.strictObject({
    doc_type: technicalId,
    version_is_current: z.boolean(),
  }),
  diff_opened: z.strictObject({}),
  answer_feedback: z.strictObject({
    rating: z.enum(FeedbackRating),
    reason: z.enum(FeedbackReason).optional(),
  }),
  quota_reached: z.strictObject({ scope: z.enum(QuotaScope) }),
  provider_fallback: z.strictObject({ from: technicalId, to: technicalId }),
  consent_updated: z.strictObject({ analytics: z.boolean() }),
  locale_changed: z.strictObject({ from: localeSchema, to: localeSchema }),
  web_vital: z.strictObject({
    name: z.enum(['LCP', 'INP', 'CLS', 'FCP', 'TTFB']),
    value: z.number().nonnegative(),
    rating: z.enum(['good', 'needs-improvement', 'poor']),
  }),
} as const

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS

export type AnalyticsEventProperties<N extends AnalyticsEventName> = z.infer<
  (typeof ANALYTICS_EVENTS)[N]
>

/** Visão do catálogo indexada pelo nome: permite ao compilador ligar o nome às propriedades. */
type AnalyticsSchemaMap = {
  readonly [N in AnalyticsEventName]: z.ZodType<AnalyticsEventProperties<N>>
}

export type AnalyticsEvent = {
  [N in AnalyticsEventName]: { readonly name: N; readonly properties: AnalyticsEventProperties<N> }
}[AnalyticsEventName]

export const ANALYTICS_EVENT_NAMES = Object.keys(ANALYTICS_EVENTS) as readonly AnalyticsEventName[]

export function isAnalyticsEventName(value: unknown): value is AnalyticsEventName {
  return typeof value === 'string' && Object.hasOwn(ANALYTICS_EVENTS, value)
}

/**
 * Valida as propriedades de um evento antes do `posthog.capture`. Lança `ZodError` se houver
 * propriedade desconhecida ou fora do formato (é assim que texto livre fica de fora).
 */
export function parseAnalyticsProperties<N extends AnalyticsEventName>(
  name: N,
  properties: unknown,
): AnalyticsEventProperties<N> {
  const schemas: AnalyticsSchemaMap = ANALYTICS_EVENTS
  return schemas[name].parse(properties)
}
