import { type AnalyticsEvent, latencyBucket } from '@teko/shared/analytics'
import { ApiError } from '../api/errors.ts'
import { answerView, type TekoUIMessage } from '../chat/parts.ts'
import type { Analytics } from './adapter.ts'

/**
 * Eventos do catálogo a partir do que o chat já tem na mão (mensagem final, erro do `useChat`).
 * Nada aqui lê o texto da pergunta nem da resposta: só metadados (`data-meta`, `data-refusal`,
 * `data-clarification` e os metadados do `finish`). Carregado só com o chat (fora do first-load).
 */

/** `trace_id` W3C (32 hex), o mesmo do `x-trace-id` da API. */
const TRACE_ID = /^[0-9a-f]{32}$/

/**
 * Família do modelo, sem versão (`gemini-3.6-flash` → `gemini-flash`,
 * `openai/gpt-oss-120b` → `gpt-oss-120b`): agrupa as respostas sem quebrar a série a cada versão.
 */
export function modelFamily(model: string): string {
  const name = model.toLowerCase().split('/').at(-1) ?? ''
  const family = name
    .split('-')
    .filter((segment) => !/^\d+(?:\.\d+)*$/.test(segment))
    .join('-')
  return family === '' ? name : family
}

function traceProperty(message: TekoUIMessage): { trace_id?: string } {
  const traceId = message.metadata?.traceId
  return traceId !== undefined && TRACE_ID.test(traceId) ? { trace_id: traceId } : {}
}

/**
 * Eventos de uma resposta que terminou (sem abort nem erro): `clarification_shown`,
 * `answer_refused` ou `answer_completed`, este com `provider_fallback` quando a API trocou de
 * provedor. Resposta do cache não traz os metadados do `finish`: a família sai do provedor.
 */
export function answerEvents(message: TekoUIMessage, elapsedMs: number): AnalyticsEvent[] {
  const view = answerView(message)
  if (view.clarification !== null) {
    return [{ name: 'clarification_shown', properties: {} }]
  }
  if (view.refusal !== null) {
    return [
      {
        name: 'answer_refused',
        properties: { reason: view.refusal.reason, ...traceProperty(message) },
      },
    ]
  }
  if (view.meta === null) {
    return []
  }
  const model = message.metadata?.model
  const events: AnalyticsEvent[] = [
    {
      name: 'answer_completed',
      properties: {
        model_family: model === undefined ? view.meta.provider : modelFamily(model),
        cached: view.meta.cached,
        retrieval_mode: view.meta.retrievalMode,
        latency_bucket: latencyBucket(Math.max(0, elapsedMs)),
        ...traceProperty(message),
      },
    },
  ]
  if (view.meta.fallbackFrom !== null && model !== undefined) {
    events.push({
      name: 'provider_fallback',
      properties: { from: view.meta.fallbackFrom.toLowerCase(), to: model.toLowerCase() },
    })
  }
  return events
}

/** `quota_reached` quando a API recusou a pergunta por cota (o escopo vem no problem+json). */
export function quotaReachedEvent(error: Error | undefined): AnalyticsEvent | null {
  return error instanceof ApiError && error.quota !== null
    ? { name: 'quota_reached', properties: { scope: error.quota.scope } }
    : null
}

/** Repassa os eventos ao adapter (que descarta tudo sem consentimento). */
export function captureEvents(
  target: Pick<Analytics, 'capture'>,
  events: readonly AnalyticsEvent[],
): void {
  for (const event of events) {
    target.capture(event.name, event.properties)
  }
}
