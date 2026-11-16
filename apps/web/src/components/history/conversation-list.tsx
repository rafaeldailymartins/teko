'use client'

import { ErrorCode } from '@teko/shared/errors'
import { isoDateInTimeZone, periodoApuracaoOf } from '@teko/shared/vigencia'
import { ChevronRightIcon, CircleAlertIcon, MessagesSquareIcon, SearchIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { useQueryStates } from 'nuqs'
import { Suspense, useId, useState } from 'react'
import { useCloseHistoryPanel } from '@/components/app-shell/workspace'
import { EmptyState } from '@/components/empty-state'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { ListConversationsResponse } from '@/lib/api/__generated__/types.gen'
import { useConversations } from '@/lib/api/hooks'
import { filterByTitle, groupHistory, HistoryGroup } from '@/lib/history'
import { formatTaxPeriod } from '@/lib/i18n/format'
import { localePagePath } from '@/lib/navigation'
import { chatConversationHref, chatSearchParams } from '@/lib/url-state'
import { cn } from '@/lib/utils'

type Conversation = ListConversationsResponse['items'][number]
type Variant = 'panel' | 'page'

/** Chaves estáveis das linhas do skeleton (são fixas, sem dado por trás). */
const SKELETON_ROWS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'] as const

/** A partir de quantas conversas carregadas a busca aparece. */
const SEARCH_THRESHOLD = 4

interface ConversationListProps {
  /**
   * `panel`: o painel do chat (primeira página, link para o histórico completo e a conversa aberta
   * marcada). `page`: a página `/history/`, com "Carregar mais".
   */
  readonly variant: Variant
}

/** Carregamento com a forma dos itens, para a lista não pular quando os dados chegam. */
function ConversationListLoading({ variant }: ConversationListProps) {
  const t = useTranslations('history')
  return (
    <div role="status" className={variant === 'panel' ? 'py-2' : undefined}>
      <span className="sr-only">{t('loading')}</span>
      <ul
        className={cn('flex flex-col', variant === 'panel' ? 'gap-1 px-2' : 'gap-2.5')}
        aria-hidden="true"
      >
        {SKELETON_ROWS.slice(0, variant === 'panel' ? 5 : 6).map((row) => (
          <li
            key={row}
            className={cn(
              'flex flex-col gap-2',
              variant === 'panel' ? 'rounded-lg px-3 py-2.5' : 'rounded-xl border px-4 py-4',
            )}
          >
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
  readonly variant: Variant
  /** Hoje ou ontem: basta a hora; antes, a data. */
  readonly recent: boolean
  readonly onOpen: () => void
}

function ConversationItem({
  conversation,
  current,
  variant,
  recent,
  onOpen,
}: ConversationItemProps) {
  const t = useTranslations('history')
  const format = useFormatter()
  const locale = useLocale()
  const updated = new Date(conversation.updatedAt)
  return (
    <li>
      <Link
        href={chatConversationHref(locale, conversation.conversationId) as Route}
        onClick={onOpen}
        aria-current={current ? 'page' : undefined}
        className={cn(
          'group/item relative flex flex-col gap-1.5 outline-none transition-[background-color,box-shadow,border-color] duration-150 ease-out-soft focus-visible:ring-2 focus-visible:ring-ring',
          variant === 'panel'
            ? 'rounded-lg px-3 py-2.5 hover:bg-muted'
            : 'rounded-xl border bg-popover py-3.5 pr-10 pl-4 shadow-soft hover:border-border-strong/50 hover:shadow-raised',
          current &&
            'bg-popover shadow-soft ring-1 ring-border before:absolute before:top-2.5 before:bottom-2.5 before:left-0 before:w-[3px] before:rounded-full before:bg-leaf hover:bg-popover',
        )}
      >
        <span
          className={cn(
            'line-clamp-2 font-medium text-foreground',
            variant === 'panel' ? 'text-sm leading-snug' : 'text-[0.9375rem]',
          )}
        >
          {conversation.title}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground text-xs">
          <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-date-mark" />
            {t('reference', {
              date: formatTaxPeriod(locale, periodoApuracaoOf(conversation.lastReferenceDate)),
            })}
          </span>
          <span aria-hidden="true">·</span>
          <span>{t('questionCount', { count: conversation.questionCount })}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={conversation.updatedAt} className="tabular-nums">
            {recent
              ? format.dateTime(updated, { timeStyle: 'short' })
              : format.dateTime(updated, { dateStyle: 'short' })}
          </time>
        </span>
        {variant === 'page' && (
          <ChevronRightIcon
            aria-hidden="true"
            className="-translate-y-1/2 absolute top-1/2 right-3.5 size-4 text-muted-foreground transition-transform duration-150 group-hover/item:translate-x-0.5"
          />
        )}
      </Link>
    </li>
  )
}

function ConversationListContent({ variant }: ConversationListProps) {
  const t = useTranslations('history')
  const tRoot = useTranslations()
  const locale = useLocale()
  const closeHistory = useCloseHistoryPanel()
  const searchId = useId()
  const [{ c: openConversation }] = useQueryStates({ c: chatSearchParams.c })
  const [search, setSearch] = useState('')
  const [today] = useState(() => isoDateInTimeZone(new Date()))
  const query = useConversations()

  if (query.isPending) {
    return <ConversationListLoading variant={variant} />
  }

  if (query.isError) {
    const signedOut = query.error.code === ErrorCode.Unauthenticated
    return (
      <div
        role="alert"
        className={cn(
          'flex flex-col items-start gap-3 text-sm',
          variant === 'panel' ? 'px-4 py-4' : 'rounded-xl border bg-popover p-5 shadow-soft',
        )}
      >
        <p className="flex items-start gap-2 text-muted-foreground">
          <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
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
      <p className="px-4 pb-4 text-muted-foreground text-sm leading-relaxed">{t('emptyBody')}</p>
    ) : (
      <EmptyState
        icon={<MessagesSquareIcon />}
        title={t('emptyTitle')}
        className="rounded-2xl border border-dashed bg-surface"
      >
        {t('emptyBody')}
      </EmptyState>
    )
  }

  const filtered = filterByTitle(conversations, search)
  const groups = groupHistory(filtered, today)
  const GroupHeading = variant === 'panel' ? 'h3' : 'h2'

  return (
    <nav
      aria-label={t('listLabel')}
      className={cn('flex flex-col', variant === 'panel' ? 'gap-3 pb-4' : 'gap-6')}
    >
      {conversations.length >= SEARCH_THRESHOLD && (
        <div className={cn('relative', variant === 'panel' && 'px-2')}>
          <label htmlFor={searchId} className="sr-only">
            {t('searchLabel')}
          </label>
          <SearchIcon
            aria-hidden="true"
            className={cn(
              '-translate-y-1/2 pointer-events-none absolute top-1/2 size-4 text-muted-foreground',
              variant === 'panel' ? 'left-5' : 'left-3',
            )}
          />
          <input
            id={searchId}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('searchPlaceholder')}
            autoComplete="off"
            className="h-9 w-full rounded-lg border border-input/60 bg-popover pr-3 pl-9 text-sm shadow-soft outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </div>
      )}
      {groups.length === 0 && (
        <p role="status" className="px-4 text-muted-foreground text-sm">
          {t('searchEmpty', { query: search.trim() })}
        </p>
      )}
      {groups.map(({ group, items }) => (
        <section
          key={group}
          aria-labelledby={`${searchId}-${group}`}
          className="flex flex-col gap-1"
        >
          <GroupHeading
            id={`${searchId}-${group}`}
            className={cn(
              'font-semibold text-muted-foreground text-xs uppercase tracking-wider',
              variant === 'panel' ? 'px-5 pb-0.5' : 'pb-1.5',
            )}
          >
            {t(`groups.${group}`)}
          </GroupHeading>
          <ul className={cn('flex flex-col', variant === 'panel' ? 'gap-0.5 px-2' : 'gap-2.5')}>
            {items.map((conversation) => (
              <ConversationItem
                key={conversation.conversationId}
                conversation={conversation}
                current={variant === 'panel' && conversation.conversationId === openConversation}
                variant={variant}
                recent={group === HistoryGroup.Today || group === HistoryGroup.Yesterday}
                onOpen={closeHistory}
              />
            ))}
          </ul>
        </section>
      ))}
      {variant === 'panel' && query.hasNextPage && (
        <Link
          href={localePagePath(locale, 'history')}
          onClick={closeHistory}
          className={cn(buttonVariants({ variant: 'link', size: 'sm' }), 'self-start px-5')}
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
      {variant === 'page' && (
        <p className="text-center text-muted-foreground text-xs">{t('retention')}</p>
      )}
    </nav>
  )
}

/**
 * Conversas do usuário, da mais recente para a mais antiga (`GET /v1/conversations`), agrupadas
 * por dia (hoje, ontem, 7 e 30 dias, anteriores) e com busca pelo título quando há várias. Cada
 * item traz a data de referência da última pergunta em mono, com o ponto âmbar; a conversa aberta
 * fica marcada no painel. Abrir uma navega para o chat com `?c=<id>` e fecha o Sheet do histórico
 * no celular. Estados de carregamento (skeleton), vazio e erro, com nova tentativa; sem sessão, o
 * erro leva ao login. O `Suspense` é exigido pelo `useQueryStates` no export estático.
 */
export function ConversationList({ variant }: ConversationListProps) {
  return (
    <Suspense fallback={<ConversationListLoading variant={variant} />}>
      <ConversationListContent variant={variant} />
    </Suspense>
  )
}
