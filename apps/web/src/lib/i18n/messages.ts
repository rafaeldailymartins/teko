import type { Locale } from '@teko/shared/i18n'
import type ptBR from '../../../messages/pt-BR.json'

/** Formato das mensagens: `pt-BR` é a fonte; `en` precisa ter exatamente as mesmas chaves. */
export type Messages = typeof ptBR

const loaders: Readonly<Record<Locale, () => Promise<{ default: Messages }>>> = {
  'pt-BR': () => import('../../../messages/pt-BR.json'),
  en: () => import('../../../messages/en.json'),
}

/** Carrega o catálogo de um locale (chunk separado por idioma). */
export async function loadMessages(locale: Locale): Promise<Messages> {
  const module = await loaders[locale]()
  return module.default
}

/**
 * Namespaces renderizados só no servidor (no build do export): o texto longo das páginas legais e
 * do "Sobre". Ficam fora das mensagens que o `NextIntlClientProvider` serializa em toda página, que
 * senão levaria dezenas de KB de texto legal em cada HTML. Componente de cliente não usa estes
 * namespaces (`useTranslations('legal')` num `'use client'` falharia em runtime).
 */
export const SERVER_ONLY_NAMESPACES = [
  'legal',
  'about',
] as const satisfies readonly (keyof Messages)[]

type ServerOnlyNamespace = (typeof SERVER_ONLY_NAMESPACES)[number]

/** Mensagens entregues aos componentes de cliente: o catálogo sem os namespaces só de servidor. */
export function clientMessages(messages: Messages): Omit<Messages, ServerOnlyNamespace> {
  const serverOnly = new Set<string>(SERVER_ONLY_NAMESPACES)
  return Object.fromEntries(
    Object.entries(messages).filter(([namespace]) => !serverOnly.has(namespace)),
  ) as Omit<Messages, ServerOnlyNamespace>
}
