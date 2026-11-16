import { SquarePenIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AppPageHeader } from '@/components/app-page-header'
import { ConversationList } from '@/components/history/conversation-list'
import { buttonVariants } from '@/components/ui/button'
import { localePagePath } from '@/lib/navigation'
import { type LocalePageProps, pageMetadata, resolvePageLocale } from './page-route.ts'

export const generateHistoryMetadata = pageMetadata('history')

/** Histórico completo: as conversas do usuário por dia, com busca e "Carregar mais". */
export async function HistoryPage({ params }: LocalePageProps) {
  const locale = await resolvePageLocale(params)
  const t = await getTranslations({ locale, namespace: 'pages.history' })
  const tThread = await getTranslations({ locale, namespace: 'chat.thread' })
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-8 sm:py-12">
      <AppPageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={
          <Link
            href={localePagePath(locale, 'chat')}
            className={buttonVariants({ variant: 'default' })}
          >
            <SquarePenIcon aria-hidden="true" />
            {tThread('newConversation')}
          </Link>
        }
      />
      <ConversationList variant="page" />
    </div>
  )
}
