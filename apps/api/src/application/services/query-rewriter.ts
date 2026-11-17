import { ApplicationError } from '../errors.ts'
import type { LlmUsage } from '../ports/llm-port.ts'
import {
  buildRewritePrompt,
  parseRewrite,
  REWRITE_MAX_OUTPUT_TOKENS,
  REWRITE_PROMPT_VERSION,
  REWRITE_REASONING,
  REWRITE_TEMPERATURE,
} from '../prompts/rewrite.ts'
import { interruptionOf, recordFailedGeneration, trackGeneration } from './generation-trace.ts'
import type { ProviderRouter } from './provider-router.ts'
import { type QueryTrace, untracedQuery } from './trace-sampler.ts'

/**
 * Reescrita da pergunta pelo LLM antes da busca (ADR 0034): uma chamada curta à mesma cadeia da
 * resposta (breakers compartilhados, política regional respeitada), com teto próprio. Qualquer
 * falha da cadeia, o teto ou uma saída vazia devolvem `null`, e a busca segue com a pergunta
 * original; só o cancelamento pelo cliente propaga.
 *
 * Com o trace da pergunta, cada provedor tentado vira uma generation da reescrita no Langfuse
 * (`rewrite-query`), com uso e custo a preço de tabela (os tokens da reescrita não entram no
 * custo-sombra da resposta).
 */
interface RewriteOptions {
  /** Usuário do EEE, Reino Unido ou Suíça: só modelos com ZDR. */
  readonly zeroDataRetentionOnly: boolean
  readonly signal?: AbortSignal
  readonly trace?: QueryTrace
}

export type QueryRewriter = (question: string, options: RewriteOptions) => Promise<string | null>

export interface QueryRewriterDeps {
  readonly router: ProviderRouter
  /** Teto da reescrita antes de seguir com a pergunta original (ADR 0034: 4 s). */
  readonly timeoutMs: number
  /** Relógio das generations do Langfuse (padrão: `Date.now`). */
  readonly nowMs?: () => number
}

const NO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0 }

export function createQueryRewriter(deps: QueryRewriterDeps): QueryRewriter {
  const nowMs = deps.nowMs ?? Date.now
  return async (question, options) => {
    const timeout = AbortSignal.timeout(deps.timeoutMs)
    const signal =
      options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout])
    const prompt = buildRewritePrompt(question)
    const trace = options.trace ?? untracedQuery
    const request = {
      purpose: 'rewrite',
      promptVersion: REWRITE_PROMPT_VERSION,
      system: prompt.system,
      prompt: prompt.prompt,
      temperature: REWRITE_TEMPERATURE,
      maxOutputTokens: REWRITE_MAX_OUTPUT_TOKENS,
    } as const
    const generation = trackGeneration(trace, request, nowMs)
    let output = ''
    let usage = NO_USAGE
    let firstTokenAtMs: number | null = null
    try {
      for await (const event of deps.router.stream(
        {
          system: prompt.system,
          prompt: prompt.prompt,
          temperature: REWRITE_TEMPERATURE,
          maxOutputTokens: REWRITE_MAX_OUTPUT_TOKENS,
          reasoning: REWRITE_REASONING,
          signal,
        },
        {
          zeroDataRetentionOnly: options.zeroDataRetentionOnly,
          onFailedAttempt: (attempt) => {
            recordFailedGeneration(trace, request, attempt)
          },
        },
      )) {
        if (event.type === 'start') {
          generation.start(event)
        } else if (event.type === 'text') {
          firstTokenAtMs ??= nowMs()
          output += generation.text(event.text)
        } else {
          usage = event.usage
          generation.reasoning(event.reasoning)
        }
      }
    } catch (error) {
      generation.end(usage, firstTokenAtMs, interruptionOf(error, signal))
      if (options.signal?.aborted === true) {
        throw error
      }
      if (error instanceof ApplicationError || timeout.aborted) {
        return null
      }
      throw error
    }
    generation.end(usage, firstTokenAtMs, null)
    return parseRewrite(output)
  }
}
