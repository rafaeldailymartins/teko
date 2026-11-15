import { ChatWorkspace } from '@/components/chat/chat-workspace'
import { type LocalePageProps, pageMetadata, resolvePageLocale } from './page-route.ts'

export const generateChatMetadata = pageMetadata('chat')

/**
 * Página do chat: a área de trabalho em três painéis (histórico | conversa | citação). A conversa
 * carrega sob demanda no navegador; o HTML estático leva o esqueleto dela.
 */
export async function ChatPage({ params }: LocalePageProps) {
  await resolvePageLocale(params)
  return <ChatWorkspace />
}
