import { ErrorCode } from '@teko/shared/errors'
import { nextMidnightMs } from '#domain/shared/time-zone.ts'
import { ApplicationError } from '../errors.ts'
import type { Clock } from '../ports/clock.ts'
import {
  LlmError,
  LlmErrorKind,
  type LlmEvent,
  type LlmModel,
  type LlmRequest,
  type LlmUsage,
} from '../ports/llm-port.ts'

/**
 * Cadeia de LLM com circuit breakers (`docs/architecture/backend.md`, "LLM, PII, prompt e tetos"):
 * Gemini primário → Gemini de fallback → Groq (ZDR). O fallback só acontece antes do primeiro
 * token; depois dele, uma falha encerra o stream com erro. Breaker por modelo:
 *
 * - 429: aberto até o `retry-after` ou, sem ele, até a meia-noite do Pacífico (renovação da cota
 *   diária do Gemini free);
 * - 3 falhas seguidas de 5xx, rede ou outro 4xx: aberto por 60 s.
 *
 * Com `zeroDataRetentionOnly` (usuário do EEE, Reino Unido ou Suíça), só os modelos com ZDR entram.
 * Cancelamento não conta como falha do modelo.
 */
const BREAKER_FAILURE_THRESHOLD = 3
export const BREAKER_OPEN_MS = 60_000
const QUOTA_RESET_TIME_ZONE = 'America/Los_Angeles'

export type RoutedEvent =
  | {
      readonly type: 'start'
      readonly provider: LlmModel['provider']
      readonly model: string
      /** Modelo que falhou antes do primeiro token (o primeiro da cadeia), quando houve fallback. */
      readonly fallbackFrom: string | null
    }
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'finish'; readonly usage: LlmUsage }

interface RouteOptions {
  readonly zeroDataRetentionOnly: boolean
}

export interface ProviderRouter {
  stream(request: LlmRequest, options: RouteOptions): AsyncIterable<RoutedEvent>
  /** Modelos que aceitariam uma chamada agora (breaker fechado), na ordem da cadeia. */
  available(options: RouteOptions): readonly string[]
  /** A cadeia tem algum modelo com ZDR (sem ele, EEE/UK/CH não são atendidos). */
  hasZeroRetentionModel(): boolean
}

interface Breaker {
  openUntilMs: number
  consecutiveFailures: number
}

export function createProviderRouter(deps: {
  readonly models: readonly LlmModel[]
  readonly clock: Clock
}): ProviderRouter {
  const breakers = new Map<string, Breaker>(
    deps.models.map((model) => [model.model, { openUntilMs: 0, consecutiveFailures: 0 }]),
  )
  const now = (): number => deps.clock.now().getTime()
  const breakerOf = (model: LlmModel): Breaker => breakers.get(model.model) as Breaker

  function candidates(options: RouteOptions): LlmModel[] {
    const time = now()
    return deps.models.filter(
      (model) =>
        (!options.zeroDataRetentionOnly || model.zeroDataRetention) &&
        breakerOf(model).openUntilMs <= time,
    )
  }

  function recordFailure(model: LlmModel, error: LlmError): void {
    const breaker = breakerOf(model)
    const time = now()
    if (error.kind === LlmErrorKind.RateLimited) {
      breaker.openUntilMs =
        error.retryAfterMs === null
          ? nextMidnightMs(time, QUOTA_RESET_TIME_ZONE)
          : time + error.retryAfterMs
      breaker.consecutiveFailures = 0
      return
    }
    breaker.consecutiveFailures += 1
    if (breaker.consecutiveFailures >= BREAKER_FAILURE_THRESHOLD) {
      breaker.openUntilMs = time + BREAKER_OPEN_MS
      breaker.consecutiveFailures = 0
    }
  }

  return {
    available: (options) => candidates(options).map((model) => model.model),
    hasZeroRetentionModel: () => deps.models.some((model) => model.zeroDataRetention),
    async *stream(request, options) {
      let fallbackFrom: string | null = null
      for (const model of candidates(options)) {
        const iterator = model.stream(request)[Symbol.asyncIterator]()
        let current: IteratorResult<LlmEvent>
        try {
          current = await iterator.next()
        } catch (error) {
          if (!(error instanceof LlmError)) {
            throw error
          }
          recordFailure(model, error)
          fallbackFrom ??= model.model
          continue
        }
        breakerOf(model).consecutiveFailures = 0
        yield { type: 'start', provider: model.provider, model: model.model, fallbackFrom }
        while (current.done !== true) {
          yield current.value
          try {
            current = await iterator.next()
          } catch (error) {
            if (error instanceof LlmError) {
              recordFailure(model, error)
              throw new ApplicationError({ code: ErrorCode.UpstreamUnavailable })
            }
            throw error
          }
        }
        return
      }
      throw new ApplicationError({ code: ErrorCode.UpstreamUnavailable })
    },
  }
}
