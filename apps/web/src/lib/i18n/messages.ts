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
