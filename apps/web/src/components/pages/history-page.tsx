import { getTranslations } from 'next-intl/server'
import { ConversationList } from '@/components/history/conversation-list'
import { type LocalePageProps, pageMetadata, resolvePageLocale } from './page-route.ts'

export const generateHistoryMetadata = pageMetadata('history')

/** Histórico completo: todas as conversas do usuário, com "Carregar mais". */
export async function HistoryPage({ params }: LocalePageProps) {
  const locale = await resolvePageLocale(params)
  const t = await getTranslations({ locale, namespace: 'pages.history' })
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-10 sm:py-14">
      <header className="flex flex-col gap-2">
        <h1 className="font-semibold font-serif text-3xl tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </header>
      <ConversationList variant="page" />
    </div>
  )
}
