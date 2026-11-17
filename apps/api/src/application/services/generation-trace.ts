import type { LlmUsage } from '../ports/llm-port.ts'
import type { GenerationObservation, GenerationStart } from '../ports/llm-tracing.ts'
import { costBreakdown } from './pricing.ts'
import type { FailedAttempt, RoutedEvent } from './provider-router.ts'
import type { QueryTrace } from './trace-sampler.ts'

/**
 * Generations do Langfuse de uma chamada à cadeia de LLM (a resposta e a reescrita da pergunta):
 * uma por provedor tentado. A que falhou antes do primeiro token vem do `onFailedAttempt` do
 * router, sem uso nem custo; a que respondeu abre no `start` do router, junta o texto que saiu e o
 * raciocínio do `finish`, e fecha uma vez, com uso, custo a preço de tabela (`pricing.ts`) e TTFT.
 */

/** O que a chamada pede ao modelo (igual para todos os provedores tentados). */
export type GenerationRequest = Pick<
  GenerationStart,
  'purpose' | 'promptVersion' | 'system' | 'prompt' | 'temperature' | 'maxOutputTokens'
>

const NO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0 }
const NO_COST = { input: 0, output: 0, total: 0 }

/** Generation de um modelo que falhou antes do primeiro token. */
export function recordFailedGeneration(
  trace: QueryTrace,
  request: GenerationRequest,
  attempt: FailedAttempt,
): void {
  trace
    .generation({
      ...request,
      provider: attempt.provider,
      model: attempt.model,
      startedAtMs: attempt.startedAtMs,
    })
    .end({
      error: attempt.error,
      usage: NO_USAGE,
      cost: NO_COST,
      firstTokenAtMs: null,
      output: null,
      reasoning: null,
      endedAtMs: attempt.endedAtMs,
    })
}

type StartEvent = Extract<RoutedEvent, { readonly type: 'start' }>

export interface GenerationTracker {
  start(event: StartEvent): void
  /** Junta o texto que saiu e o devolve, para encadear. */
  text(piece: string): string
  /** Guarda o raciocínio que o modelo devolveu no `finish` (vazio ou ausente: nenhum). */
  reasoning(text: string | undefined): void
  /** Fecha a generation aberta (se houver), uma vez; `error` é o tipo da falha ou `null`. */
  end(usage: LlmUsage, firstTokenAtMs: number | null, error: string | null): void
}

export function trackGeneration(
  trace: QueryTrace,
  request: GenerationRequest,
  nowMs: () => number,
): GenerationTracker {
  let open: { readonly observation: GenerationObservation; readonly model: string } | null = null
  let output = ''
  let reasoning: string | null = null
  return {
    start(event) {
      open = {
        model: event.model,
        observation: trace.generation({
          ...request,
          provider: event.provider,
          model: event.model,
          startedAtMs: event.attemptStartedAtMs,
        }),
      }
    },
    text(piece) {
      output += piece
      return piece
    },
    reasoning(text) {
      reasoning = text === undefined || text.trim() === '' ? null : text
    },
    end(usage, firstTokenAtMs, error) {
      if (open === null) {
        return
      }
      open.observation.end({
        error,
        usage,
        cost: costBreakdown(open.model, usage),
        firstTokenAtMs,
        output: output === '' ? null : output,
        reasoning,
        endedAtMs: nowMs(),
      })
      open = null
    },
  }
}

/** Tipo da falha que interrompeu a generation (cancelamento, teto, provedor). */
export function interruptionOf(error: unknown, signal: AbortSignal): string {
  if (signal.aborted) {
    return 'aborted'
  }
  return error instanceof Error ? error.name : 'unknown'
}
