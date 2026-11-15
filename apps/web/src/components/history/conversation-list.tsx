'use client'

import { ErrorCode } from '@teko/shared/errors'
import { MessagesSquareIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { useQueryStates } from 'nuqs'
import { Suspense } from 'react'
import { useCloseHistoryPanel } from '@/components/app-shell/workspace'
import { EmptyState } from '@/components/empty-state'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { ListConversationsResponse } from '@/lib/api/__generated__/types.gen'
import { useConversations } from '@/lib/api/hooks'
import { localePagePath } from '@/lib/navigation'
import { chatConversationHref, chatSearchParams } from '@/lib/url-state'
import { cn } from '@/lib/utils'
import { calendarDate, MONTH_FORMAT } from '@/lib/validity'

type Conversation = ListConversationsResponse['items'][number]
type Variant = 'panel' | 'page'

/** Chaves estáveis das linhas do skeleton (são fixas, sem dado por trás). */
const SKELETON_ROWS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'] as const

interface ConversationListProps {
  /**
   * `panel`: o painel do chat (primeira página, link para o histórico completo e a conversa aberta
   * marcada). `page`: a página `/history/`, com "Carregar mais".
   */
  readonly variant: Variant
}

/** Carregamento com a mesma altura dos itens, para a lista não pular quando os dados chegam. */
function ConversationListLoading({ variant }: ConversationListProps) {
  const t = useTranslations('history')
  return (
    <div role="status" className="py-2">
      <span className="sr-only">{t('loading')}</span>
      <ul className="flex flex-col gap-1 px-2" aria-hidden="true">
        {SKELETON_ROWS.slice(0, variant === 'panel' ? 5 : 8).map((row) => (
          <li key={row} className="flex flex-col gap-2 rounded-lg px-2 py-2.5">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-1/2" />
          </li>
        ))}
      </ul>
    </div>
  )
}

interface ConversationItemProps {
  readonly conversation: Conversation
  readonly current: boolean
  readonly onOpen: () => void
}

function ConversationItem({ conversation, current, onOpen }: ConversationItemProps) {
  const t = useTranslations('history')
  const format = useFormatter()
  const locale = useLocale()
  return (
    <li>
      <Link
        href={chatConversationHref(locale, conversation.conversationId) as Route}
        onClick={onOpen}
        aria-current={current ? 'page' : undefined}
        className={cn(
          'flex flex-col gap-1 rounded-lg px-2 py-2 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
          current && 'bg-muted',
        )}
      >
        <span className="line-clamp-2 font-medium text-foreground text-sm">
          {conversation.title}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground text-xs">
          <span className="font-mono tabular-nums">
            {t('reference', {
              date: format.dateTime(calendarDate(conversation.lastReferenceDate), MONTH_FORMAT),
            })}
          </span>
          <span>{t('questionCount', { count: conversation.questionCount })}</span>
          <time dateTime={conversation.updatedAt}>
            {format.dateTime(new Date(conversation.updatedAt), {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </time>
        </span>
      </Link>
    </li>
  )
}

function ConversationListContent({ variant }: ConversationListProps) {
  const t = useTranslations('history')
  const tRoot = useTranslations()
  const locale = useLocale()
  const closeHistory = useCloseHistoryPanel()
  const [{ c: openConversation }] = useQueryStates({ c: chatSearchParams.c })
  const query = useConversations()

  if (query.isPending) {
    return <ConversationListLoading variant={variant} />
  }

  if (query.isError) {
    const signedOut = query.error.code === ErrorCode.Unauthenticated
    return (
      <div role="alert" className="flex flex-col items-start gap-3 px-4 py-4 text-sm">
        <p className="text-muted-foreground">
          {signedOut ? tRoot(query.error.messageKey) : t('error')}
        </p>
        {signedOut ? (
          <Link
            href={localePagePath(locale, 'sign-in')}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            {t('signIn')}
          </Link>
        ) : (
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            {t('retry')}
          </Button>
        )}
      </div>
    )
  }

  const pages = query.data.pages
  const conversations =
    variant === 'panel' ? (pages[0]?.items ?? []) : pages.flatMap((page) => page.items)
  if (conversations.length === 0) {
    return variant === 'panel' ? (
      <p className="px-4 pb-4 text-muted-foreground text-sm">{t('emptyBody')}</p>
    ) : (
      <EmptyState
        icon={<MessagesSquareIcon />}
        title={t('emptyTitle')}
        className="rounded-xl border border-dashed bg-surface"
      >
        {t('emptyBody')}
      </EmptyState>
    )
  }

  return (
    <nav aria-label={t('listLabel')} className="flex flex-col gap-2 pb-4">
      <ul className="flex flex-col gap-0.5 px-2">
        {conversations.map((conversation) => (
          <ConversationItem
            key={conversation.conversationId}
            conversation={conversation}
            current={variant === 'panel' && conversation.conversationId === openConversation}
            onOpen={closeHistory}
          />
        ))}
      </ul>
      {variant === 'panel' && query.hasNextPage && (
        <Link
          href={localePagePath(locale, 'history')}
          onClick={closeHistory}
          className={cn(buttonVariants({ variant: 'link', size: 'sm' }), 'self-start')}
        >
          {t('viewAll')}
        </Link>
      )}
      {variant === 'page' && query.hasNextPage && (
        <Button
          variant="outline"
          className="self-center"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? t('loadingMore') : t('loadMore')}
        </Button>
      )}
      {variant === 'page' && <p className="px-4 text-muted-foreground text-xs">{t('retention')}</p>}
    </nav>
  )
}

/**
 * Conversas do usuário, da mais recente para a mais antiga (`GET /v1/conversations`). Abrir uma
 * navega para o chat com `?c=<id>` e fecha o Sheet do histórico no celular. Estados de carregamento
 * (skeleton), vazio e erro, com nova tentativa; sem sessão, o erro leva ao login. O `Suspense` é
 * exigido pelo `useQueryStates` no export estático.
 */
export function ConversationList({ variant }: ConversationListProps) {
  return (
    <Suspense fallback={<ConversationListLoading variant={variant} />}>
      <ConversationListContent variant={variant} />
    </Suspense>
  )
}
