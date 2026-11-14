import type { LlmProvider } from '@teko/shared/contracts'

/**
 * Um modelo de linguagem (Gemini, Groq ou o fake de testes). A cadeia com fallback e breakers fica
 * no `ProviderRouter`; cada adapter só fala com um modelo, num host fixo no código.
 *
 * `stream` devolve os pedaços de texto e, por último, o uso de tokens. Falhas do provedor saem
 * como `LlmError`; o cancelamento pelo `signal` sai como o `reason` do próprio sinal.
 */
/**
 * Raciocínio interno do modelo antes do texto (Gemini 3 e `gpt-oss` pensam por padrão). Os tokens
 * de raciocínio contam no `maxOutputTokens`: uma chamada curta, como a reescrita da pergunta, pede
 * o mínimo para a saída não sair cortada (ADR 0034). Sem o campo, vale o padrão do provedor.
 */
type LlmReasoning = 'minimal' | 'low'

export interface LlmRequest {
  readonly system: string
  readonly prompt: string
  readonly temperature: number
  readonly maxOutputTokens: number
  readonly reasoning?: LlmReasoning
  readonly signal: AbortSignal
}

export interface LlmUsage {
  readonly inputTokens: number
  readonly outputTokens: number
}

export type LlmEvent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'finish'; readonly usage: LlmUsage }

export interface LlmModel {
  readonly provider: LlmProvider
  readonly model: string
  /** Sem retenção de dados no provedor (Groq com ZDR): o único caminho para EEE/UK/CH. */
  readonly zeroDataRetention: boolean
  stream(request: LlmRequest): AsyncIterable<LlmEvent>
}

export const LlmErrorKind = {
  /** 429: cota do provedor esgotada (breaker aberto até o `retry-after` ou a meia-noite do Pacífico). */
  RateLimited: 'rate_limited',
  /** 5xx, rede ou timeout: conta para o breaker de 3 falhas. */
  Unavailable: 'unavailable',
  /** Outro 4xx (chave inválida, modelo inexistente): também conta para o breaker. */
  Rejected: 'rejected',
} as const
export type LlmErrorKind = (typeof LlmErrorKind)[keyof typeof LlmErrorKind]

export class LlmError extends Error {
  readonly kind: LlmErrorKind
  /** `retry-after` informado pelo provedor, em ms (`null` sem o header). */
  readonly retryAfterMs: number | null

  constructor(kind: LlmErrorKind, message: string, retryAfterMs: number | null = null) {
    super(message)
    this.name = 'LlmError'
    this.kind = kind
    this.retryAfterMs = retryAfterMs
  }
}
