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

/**
 * O raciocínio do modelo chega junto do uso, no `finish`, e não como evento próprio: o router trata
 * o primeiro evento como o início da resposta (depois dele, não há fallback), e o raciocínio vem
 * antes do texto. Só o trace do Langfuse o lê.
 */
export type LlmEvent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'finish'; readonly usage: LlmUsage; readonly reasoning?: string }

export interface LlmModel {
  readonly provider: LlmProvider
  readonly model: string
  /** Sem retenção de dados no provedor (Groq com ZDR): o único caminho para EEE/UK/CH. */
  readonly zeroDataRetention: boolean
  stream(request: LlmRequest): AsyncIterable<LlmEvent>
}

export const LlmErrorKind = {
  /**
   * 429: cota do provedor esgotada. O breaker abre até a meia-noite do Pacífico se a cota diária
   * acabou; senão, pelo prazo que o provedor informou ou, sem prazo, por 60 s (ADR 0007, adendo).
   */
  RateLimited: 'rate_limited',
  /** 5xx, rede ou timeout: conta para o breaker de 3 falhas. */
  Unavailable: 'unavailable',
  /** Outro 4xx (chave inválida, modelo inexistente): também conta para o breaker. */
  Rejected: 'rejected',
} as const
export type LlmErrorKind = (typeof LlmErrorKind)[keyof typeof LlmErrorKind]

interface LlmErrorOptions {
  readonly retryAfterMs?: number | null
  readonly dailyQuota?: boolean
}

export class LlmError extends Error {
  readonly kind: LlmErrorKind
  /** Prazo informado pelo provedor para tentar de novo, em ms (`null` sem prazo). */
  readonly retryAfterMs: number | null
  /** O 429 é da cota diária (só renova à meia-noite do Pacífico), não de um limite por minuto. */
  readonly dailyQuota: boolean

  constructor(kind: LlmErrorKind, message: string, options: LlmErrorOptions = {}) {
    super(message)
    this.name = 'LlmError'
    this.kind = kind
    this.retryAfterMs = options.retryAfterMs ?? null
    this.dailyQuota = options.dailyQuota ?? false
  }
}
