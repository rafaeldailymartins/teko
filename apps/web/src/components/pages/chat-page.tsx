import { MessageSquareTextIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { Workspace } from '@/components/app-shell/workspace'
import { EmptyState } from '@/components/empty-state'
import { ConversationList } from '@/components/history/conversation-list'
import { type LocalePageProps, pageMetadata, resolvePageLocale } from './page-route.ts'

export const generateChatMetadata = pageMetadata('chat')

/**
 * Página do chat: a área de trabalho em três painéis com os estados vazios. A conversa, o
 * histórico e a citação de verdade entram com a mudança `add-chat-experience`.
 */
export async function ChatPage({ params }: LocalePageProps) {
  const locale = await resolvePageLocale(params)
  const t = await getTranslations({ locale, namespace: 'pages.chat' })
  const tPanels = await getTranslations({ locale, namespace: 'shell.panels' })

  return (
    <Workspace
      history={<ConversationList variant="panel" />}
      citation={
        <p className="px-4 pb-4 text-muted-foreground text-sm">{tPanels('citationEmpty')}</p>
      }
    >
      <EmptyState
        icon={<MessageSquareTextIcon />}
        title={t('emptyTitle')}
        headingLevel={1}
        className="h-full justify-center"
      >
        {t('emptyBody')}
      </EmptyState>
    </Workspace>
  )
}
