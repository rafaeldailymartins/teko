import type { Locale } from '@teko/shared/i18n'
import type { Messages } from './messages.ts'

declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale
    Messages: Messages
  }
}
