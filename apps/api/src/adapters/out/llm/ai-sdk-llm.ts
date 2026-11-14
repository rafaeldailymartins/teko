import { createGoogle } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import { APICallError, type LanguageModel, streamText } from 'ai'
import {
  LlmError,
  LlmErrorKind,
  type LlmEvent,
  type LlmModel,
  type LlmRequest,
} from '#app/ports/llm-port.ts'

/**
 * Gemini e Groq pelo AI SDK da Vercel (decisão do mantenedor em 2026-11-14: `@google/genai` não tem
 * proveniência). Cada provedor fala com um host fixo no código, por um `fetch` que recusa qualquer
 * outra origem: a asserção vale sobre o host efetivo de cada requisição, não só sobre a
 * configuração. Sem retries do SDK (`maxRetries: 0`): o fallback e os breakers são do
 * `ProviderRouter`. Sem tools nem grounding.
 */

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'

type Fetch = typeof fetch

function urlOf(input: Parameters<Fetch>[0]): URL {
  if (typeof input === 'string') {
    return new URL(input)
  }
  return input instanceof URL ? input : new URL(input.url)
}

/** `fetch` que só alcança a origem de `baseUrl`; outra origem falha antes da rede. */
export function pinnedFetch(baseUrl: string, inner: Fetch = fetch): Fetch {
  const allowed = new URL(baseUrl).origin
  return async (input, init) => {
    const target = urlOf(input)
    if (target.origin !== allowed) {
      throw new Error(`LLM: origem ${target.origin} recusada (só ${allowed})`)
    }
    return inner(input, init)
  }
}

/** `retry-after` em segundos ou data HTTP, em ms a partir de `nowMs`. */
export function retryAfterMs(value: string | undefined, nowMs: number): number | null {
  if (value === undefined || value.trim() === '') {
    return null
  }
  const seconds = Number(value)
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.round(seconds * 1000))
  }
  const date = Date.parse(value)
  return Number.isNaN(date) ? null : Math.max(0, date - nowMs)
}

/** Converte a falha do SDK no erro da porta; o cancelamento passa intacto. */
export function toLlmError(error: unknown, signal: AbortSignal, nowMs: number): unknown {
  if (signal.aborted) {
    return signal.reason
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode
    if (status === 429) {
      return new LlmError(
        LlmErrorKind.RateLimited,
        'provider rate limited',
        retryAfterMs(error.responseHeaders?.['retry-after'], nowMs),
      )
    }
    if (status !== undefined && status >= 400 && status < 500 && !error.isRetryable) {
      return new LlmError(
        LlmErrorKind.Rejected,
        `provider rejected the request (${String(status)})`,
      )
    }
    return new LlmError(LlmErrorKind.Unavailable, `provider unavailable (${String(status)})`)
  }
  return new LlmError(LlmErrorKind.Unavailable, 'provider unreachable')
}

interface ModelIdentity {
  readonly provider: 'gemini' | 'groq'
  readonly model: string
  readonly zeroDataRetention: boolean
}

function createAiSdkLlm(
  languageModel: LanguageModel,
  identity: ModelIdentity,
  now: () => number = Date.now,
): LlmModel {
  return {
    ...identity,
    async *stream(request: LlmRequest): AsyncIterable<LlmEvent> {
      const result = streamText({
        model: languageModel,
        system: request.system,
        prompt: request.prompt,
        temperature: request.temperature,
        maxOutputTokens: request.maxOutputTokens,
        abortSignal: request.signal,
        maxRetries: 0,
        // O erro chega pelo `fullStream` e vira `LlmError`; o padrão do SDK o imprimiria no console.
        onError: () => {},
      })
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          yield { type: 'text', text: part.text }
        } else if (part.type === 'error') {
          throw toLlmError(part.error, request.signal, now())
        } else if (part.type === 'abort') {
          throw request.signal.reason
        } else if (part.type === 'finish') {
          yield {
            type: 'finish',
            usage: {
              inputTokens: part.totalUsage.inputTokens ?? 0,
              outputTokens: part.totalUsage.outputTokens ?? 0,
            },
          }
        }
      }
    },
  }
}

export interface LlmChainConfig {
  readonly geminiApiKey: string
  readonly groqApiKey: string
  readonly geminiModels: readonly string[]
  readonly groqModel: string
  readonly fetch?: Fetch
}

/** Cadeia do plano: Gemini primário → Gemini de fallback → Groq (ZDR). */
export function createLlmChain(config: LlmChainConfig): LlmModel[] {
  const google = createGoogle({
    apiKey: config.geminiApiKey,
    baseURL: GEMINI_BASE_URL,
    fetch: pinnedFetch(GEMINI_BASE_URL, config.fetch),
  })
  const groq = createGroq({
    apiKey: config.groqApiKey,
    baseURL: GROQ_BASE_URL,
    fetch: pinnedFetch(GROQ_BASE_URL, config.fetch),
  })
  return [
    ...config.geminiModels.map((model) =>
      createAiSdkLlm(google(model), { provider: 'gemini', model, zeroDataRetention: false }),
    ),
    createAiSdkLlm(groq(config.groqModel), {
      provider: 'groq',
      model: config.groqModel,
      zeroDataRetention: true,
    }),
  ]
}
