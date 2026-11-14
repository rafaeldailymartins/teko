import { z } from 'zod'
import { type TranslatorPort, TranslatorUnavailableError } from '#app/ports/translator-port.ts'
import {
  postWorkersAi,
  workersAiEndpoint,
} from '../../embeddings/workers-ai/workers-ai-embedding-adapter.ts'

/**
 * `m2m100-1.2b` pelo Workers AI (REST): `POST https://api.cloudflare.com/client/v4/accounts/{id}/
 * ai/run/@cf/meta/m2m100-1.2b` com `{ text, source_lang: 'en', target_lang: 'pt' }`. Resposta
 * `{ result: { translated_text }, success }` (ADR 0034). Mesmo host fixo do adapter de embeddings.
 *
 * Falhas de rede e HTTP, corpo ilegível, resposta fora do esquema ou tradução vazia viram
 * `TranslatorUnavailableError`: a busca segue com a pergunta original.
 */

export const M2M100_MODEL = '@cf/meta/m2m100-1.2b'

const responseSchema = z.object({
  success: z.boolean(),
  result: z.object({ translated_text: z.string().optional() }).nullable().optional(),
})

export interface WorkersAiTranslatorOptions {
  readonly accountId: string
  readonly apiToken: string
  /** Injetável nos testes; o padrão é o `fetch` global. */
  readonly fetch?: typeof fetch
}

export function createWorkersAiTranslatorAdapter(
  options: WorkersAiTranslatorOptions,
): TranslatorPort {
  const endpoint = workersAiEndpoint(options.accountId, M2M100_MODEL)
  const doFetch = options.fetch ?? fetch
  return {
    model: M2M100_MODEL,
    async toPortuguese(text, translateOptions) {
      const reply = await postWorkersAi(
        {
          endpoint,
          apiToken: options.apiToken,
          payload: { text, source_lang: 'en', target_lang: 'pt' },
          signal: translateOptions?.signal,
          fetch: doFetch,
        },
        (message, errorOptions) => new TranslatorUnavailableError(message, errorOptions),
      )
      const parsed = responseSchema.safeParse(reply.body)
      const translated = parsed.success ? parsed.data.result?.translated_text?.trim() : undefined
      if (
        !parsed.success ||
        !parsed.data.success ||
        translated === undefined ||
        translated === ''
      ) {
        throw new TranslatorUnavailableError('Workers AI devolveu uma tradução inesperada')
      }
      return translated
    },
  }
}
