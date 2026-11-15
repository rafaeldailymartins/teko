import { idSchema, stableKeySchema } from '@teko/shared/contracts'
import type { Locale } from '@teko/shared/i18n'
import type { ReferenceInput } from '@teko/shared/vigencia'
import { createParser, createSerializer } from 'nuqs'
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

/** `k`: chave estável do dispositivo (`go:rcte:art:76:par:6`), no formato do shared. */
const parseAsStableKey = createParser({
  parse: (value) => {
    const result = stableKeySchema.safeParse(value)
    return result.success ? result.data : null
  },
  serialize: (value: string) => value,
})

/** Página de dispositivo: `/pt-BR/provision/?k=<stableKey>&ref=2008-05`. */
export const provisionSearchParams = {
  /** Dispositivo aberto. */
  k: parseAsStableKey,
  /** Data em que a redação é mostrada; ausente = hoje. */
  ref: parseAsReference,
} as const

/** Comparação entre datas: `/pt-BR/compare/?k=<stableKey>&from=2008-05&to=2010-01`. */
export const compareSearchParams = {
  k: parseAsStableKey,
  from: parseAsReference,
  to: parseAsReference,
} as const

const serializeChat = createSerializer(chatSearchParams)
const serializeProvision = createSerializer(provisionSearchParams)
const serializeCompare = createSerializer(compareSearchParams)

/** Conversa aberta no chat (`/pt-BR/chat/?c=<id>`). */
export function chatConversationHref(locale: Locale, conversationId: string): string {
  return `/${locale}/chat/${serializeChat({ c: conversationId })}`
}

/** Dispositivo numa data (`ref` ausente = hoje). */
export function provisionHref(
  locale: Locale,
  stableKey: string,
  ref: ReferenceInput | null = null,
): string {
  return `/${locale}/provision/${serializeProvision({ k: stableKey, ref })}`
}

/** Comparação entre as redações de duas datas. */
export function compareHref(
  locale: Locale,
  stableKey: string,
  from: ReferenceInput | null,
  to: ReferenceInput | null,
): string {
  return `/${locale}/compare/${serializeCompare({ k: stableKey, from, to })}`
}
