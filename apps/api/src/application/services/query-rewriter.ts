import { ApplicationError } from '../errors.ts'
import {
  buildRewritePrompt,
  parseRewrite,
  REWRITE_MAX_OUTPUT_TOKENS,
  REWRITE_TEMPERATURE,
} from '../prompts/rewrite.ts'
import type { ProviderRouter } from './provider-router.ts'

/**
 * Reescrita da pergunta pelo LLM antes da busca (ADR 0034): uma chamada curta à mesma cadeia da
 * resposta (breakers compartilhados, política regional respeitada), com teto próprio. Qualquer
 * falha da cadeia, o teto ou uma saída vazia devolvem `null`, e a busca segue com a pergunta
 * original; só o cancelamento pelo cliente propaga.
 */
interface RewriteOptions {
  /** Usuário do EEE, Reino Unido ou Suíça: só modelos com ZDR. */
  readonly zeroDataRetentionOnly: boolean
  readonly signal?: AbortSignal
}

export type QueryRewriter = (question: string, options: RewriteOptions) => Promise<string | null>

export interface QueryRewriterDeps {
  readonly router: ProviderRouter
  /** Teto da reescrita antes de seguir com a pergunta original (ADR 0034: 4 s). */
  readonly timeoutMs: number
}

export function createQueryRewriter(deps: QueryRewriterDeps): QueryRewriter {
  return async (question, options) => {
    const timeout = AbortSignal.timeout(deps.timeoutMs)
    const signal =
      options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout])
    const prompt = buildRewritePrompt(question)
    let output = ''
    try {
      for await (const event of deps.router.stream(
        {
          system: prompt.system,
          prompt: prompt.prompt,
          temperature: REWRITE_TEMPERATURE,
          maxOutputTokens: REWRITE_MAX_OUTPUT_TOKENS,
          signal,
        },
        { zeroDataRetentionOnly: options.zeroDataRetentionOnly },
      )) {
        if (event.type === 'text') {
          output += event.text
        }
      }
    } catch (error) {
      if (options.signal?.aborted === true) {
        throw error
      }
      if (error instanceof ApplicationError || timeout.aborted) {
        return null
      }
      throw error
    }
    return parseRewrite(output)
  }
}
