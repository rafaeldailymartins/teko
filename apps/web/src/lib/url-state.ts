import { idSchema } from '@teko/shared/contracts'
import { createParser } from 'nuqs'
import { parseReference, serializeReference } from './api/reference.ts'

/**
 * Estado do chat na query string, no lugar de rotas dinâmicas (o export estático não as tem):
 * `/pt-BR/chat/?q=<questionId>&c=<conversationId>&ref=2024-03`. Valor inválido na URL vira `null`
 * (o nuqs descarta), nunca exceção: a URL é entrada do usuário.
 */

const parseAsId = createParser({
  parse: (value) => {
    const result = idSchema.safeParse(value)
    return result.success ? result.data : null
  },
  serialize: (value: string) => value,
})

/** `ref`: período de apuração (`2024-03`) ou data exata (`2024-03-15`), validados pelo shared. */
const parseAsReference = createParser({
  parse: parseReference,
  serialize: serializeReference,
  eq: (left, right) => serializeReference(left) === serializeReference(right),
})

/** Parsers do chat para `useQueryStates(chatSearchParams)`. */
export const chatSearchParams = {
  /** Pergunta aberta (`GET /questions/:id`). */
  q: parseAsId,
  /** Conversa (histórico). */
  c: parseAsId,
  /** Data de referência escolhida; ausente = `source: 'default'` na API. */
  ref: parseAsReference,
} as const
