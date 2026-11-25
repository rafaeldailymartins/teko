import { createGoogle, type GoogleLanguageModelOptions } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import type { Span } from '@opentelemetry/api'
import { APICallError, type LanguageModel, streamText } from 'ai'
import { z } from 'zod'
import {
  LlmError,
  LlmErrorKind,
  type LlmEvent,
  type LlmModel,
  type LlmRequest,
} from '#app/ports/llm-port.ts'
import { tracedIterable } from '../telemetry/tracing.ts'
import { chainIdentities, type LlmChainConfig, type ModelIdentity } from './chain-models.ts'

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

/**
 * Corpo do 429 do Gemini (`google.rpc.Status`): o `QuotaFailure` diz qual cota estourou (o `quotaId`
 * da diária termina em `PerDay…`) e o `RetryInfo` traz o prazo (`retryDelay`, como `"37s"`). O
 * Gemini não manda `retry-after`; o Groq manda e não tem esse corpo.
 */
const googleErrorSchema = z.object({
  error: z.object({
    details: z.array(
      z.object({
        '@type': z.string(),
        retryDelay: z.string().optional(),
        violations: z.array(z.object({ quotaId: z.string().optional() })).optional(),
      }),
    ),
  }),
})
const RETRY_DELAY = /^(\d+(?:\.\d+)?)s$/
const DAILY_QUOTA_ID = /PerDay/

interface QuotaHint {
  readonly retryAfterMs: number | null
  readonly dailyQuota: boolean
}

/** Lê do corpo do 429 se a cota é a diária e o prazo para tentar de novo; corpo estranho não diz nada. */
export function quotaHint(responseBody: string | undefined): QuotaHint {
  let parsed: unknown
  try {
    parsed = JSON.parse(responseBody ?? '')
  } catch {
    return { retryAfterMs: null, dailyQuota: false }
  }
  const result = googleErrorSchema.safeParse(parsed)
  const details = result.success ? result.data.error.details : []
  const dailyQuota = details.some((detail) =>
    (detail.violations ?? []).some((violation) => DAILY_QUOTA_ID.test(violation.quotaId ?? '')),
  )
  const delay = details
    .map((detail) => RETRY_DELAY.exec(detail.retryDelay ?? ''))
    .find((match) => match !== null)
  return {
    retryAfterMs: delay === undefined ? null : Math.round(Number(delay[1]) * 1000),
    dailyQuota,
  }
}

/** Converte a falha do SDK no erro da porta; o cancelamento passa intacto. */
export function toLlmError(error: unknown, signal: AbortSignal, nowMs: number): unknown {
  if (signal.aborted) {
    return signal.reason
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode
    if (status === 429) {
      const hint = quotaHint(error.responseBody)
      return new LlmError(LlmErrorKind.RateLimited, 'provider rate limited', {
        retryAfterMs:
          retryAfterMs(error.responseHeaders?.['retry-after'], nowMs) ?? hint.retryAfterMs,
        dailyQuota: hint.dailyQuota,
      })
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

/** Valores de `gen_ai.provider.name` da semconv de GenAI. */
const GEN_AI_PROVIDER = { gemini: 'gcp.gemini', groq: 'groq' } as const

type ProviderOptions = Parameters<typeof streamText>[0]['providerOptions']

/**
 * O Gemini só devolve o raciocínio (o resumo dos pensamentos) com `includeThoughts`; os tokens de
 * raciocínio já são gastos e contados de qualquer forma. O nível continua vindo do `reasoning`
 * portátil (o SDK junta os dois). O `gpt-oss` do Groq devolve o raciocínio sem pedir.
 */
const GEMINI_OPTIONS = {
  google: { thinkingConfig: { includeThoughts: true } } satisfies GoogleLanguageModelOptions,
}

/**
 * Um modelo da cadeia. Cada chamada abre um span `chat <modelo>` (atributos `gen_ai.*`, com o uso
 * de tokens no fim), filho do span ativo da requisição.
 */
function createAiSdkLlm(
  languageModel: LanguageModel,
  identity: ModelIdentity,
  providerOptions?: ProviderOptions,
  now: () => number = Date.now,
): LlmModel {
  return {
    ...identity,
    stream: (request: LlmRequest): AsyncIterable<LlmEvent> =>
      tracedIterable(
        `chat ${identity.model}`,
        {
          'gen_ai.operation.name': 'chat',
          'gen_ai.provider.name': GEN_AI_PROVIDER[identity.provider],
          'gen_ai.request.model': identity.model,
          'gen_ai.request.temperature': request.temperature,
          'gen_ai.request.max_tokens': request.maxOutputTokens,
        },
        (span) => streamEvents(languageModel, request, providerOptions, now, span),
      ),
  }
}

async function* streamEvents(
  languageModel: LanguageModel,
  request: LlmRequest,
  providerOptions: ProviderOptions,
  now: () => number,
  span: Span,
): AsyncIterable<LlmEvent> {
  const result = streamText({
    model: languageModel,
    ...(providerOptions === undefined ? {} : { providerOptions }),
    system: request.system,
    prompt: request.prompt,
    temperature: request.temperature,
    maxOutputTokens: request.maxOutputTokens,
    // Nível de raciocínio portátil do AI SDK 7 (Gemini: `thinkingLevel`; Groq: `reasoning_effort`).
    ...(request.reasoning === undefined ? {} : { reasoning: request.reasoning }),
    abortSignal: request.signal,
    maxRetries: 0,
    // O erro chega pelo `fullStream` e vira `LlmError`; o padrão do SDK o imprimiria no console.
    onError: () => {},
  })
  // O raciocínio vem antes do texto e só sai no `finish` (ver `LlmEvent`): o primeiro evento
  // continua sendo o primeiro texto, e o fallback do router não muda.
  let reasoning = ''
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      yield { type: 'text', text: part.text }
    } else if (part.type === 'reasoning-delta') {
      reasoning += part.text
    } else if (part.type === 'error') {
      throw toLlmError(part.error, request.signal, now())
    } else if (part.type === 'abort') {
      throw request.signal.reason
    } else if (part.type === 'finish') {
      const usage = {
        inputTokens: part.totalUsage.inputTokens ?? 0,
        outputTokens: part.totalUsage.outputTokens ?? 0,
      }
      span.setAttributes({
        'gen_ai.usage.input_tokens': usage.inputTokens,
        'gen_ai.usage.output_tokens': usage.outputTokens,
      })
      yield { type: 'finish', usage, ...(reasoning === '' ? {} : { reasoning }) }
    }
  }
}

/**
 * Cadeia do plano (`chainIdentities`): Gemini primário → Gemini de fallback → Groq (ZDR). Este
 * módulo carrega o AI SDK; a raiz de composição o alcança só por `lazy-llm-chain.ts`, na primeira
 * pergunta.
 */
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
  return chainIdentities(config).map((identity) =>
    identity.provider === 'gemini'
      ? createAiSdkLlm(google(identity.model), identity, GEMINI_OPTIONS)
      : createAiSdkLlm(groq(identity.model), identity),
  )
}
