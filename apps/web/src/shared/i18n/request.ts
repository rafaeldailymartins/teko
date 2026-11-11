import { DISPLAY_TIME_ZONE } from '@teko/shared/i18n'
import { hasLocale } from 'next-intl'
import { getRequestConfig } from 'next-intl/server'
import { loadMessages } from './messages.ts'
import { routing } from './routing.ts'

/**
 * Configuração por requisição do next-intl (apontada em `next.config.ts`). No export estático o
 * locale vem sempre do segmento `[locale]`, fixado por `setRequestLocale` em layouts e páginas.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale
  return {
    locale,
    timeZone: DISPLAY_TIME_ZONE,
    messages: await loadMessages(locale),
  }
})
