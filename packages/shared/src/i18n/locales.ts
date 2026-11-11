import { z } from 'zod'
import type { ErrorCode } from '../errors/codes.ts'

/**
 * Locales suportados. `pt-BR` é o padrão (`defineRouting({ defaultLocale: 'pt-BR' })` na web) e o
 * idioma do corpus; trechos legais ficam em `lang="pt-BR"` mesmo na UI em inglês.
 */
export const LOCALES = ['pt-BR', 'en'] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'pt-BR'

/** Fuso de exibição de datas e horários na UI (`timeZone` do next-intl). */
export const DISPLAY_TIME_ZONE = 'America/Sao_Paulo'

export const localeSchema = z.enum(LOCALES)

export function isLocale(value: unknown): value is Locale {
  return localeSchema.safeParse(value).success
}

/** Devolve o locale suportado ou o padrão (para cabeçalhos e parâmetros não confiáveis). */
export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE
}

/** Chave de mensagem de um código de erro: a web precisa de `errors.<code>` em todos os locales. */
export type ErrorMessageKey = `errors.${ErrorCode}`

export function errorMessageKey(code: ErrorCode): ErrorMessageKey {
  return `errors.${code}`
}
