'use client'

import type { Citation } from '@teko/shared/contracts'
import type { IsoDate, ReferenceInput } from '@teko/shared/vigencia'
import { SquarePenIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { useQueryStates } from 'nuqs'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useCloseHistoryPanel, Workspace } from '@/components/app-shell/workspace'
import { useSession } from '@/components/auth/use-session'
import { ConversationList } from '@/components/history/conversation-list'
import { buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { analytics } from '@/lib/analytics'
import { type CitationSelection, selectedCitation, stepSelection } from '@/lib/chat/selection'
import { citationStep, isEditableTarget } from '@/lib/hotkeys'
import { chatSearchParams, newConversationHref } from '@/lib/url-state'
import { BlockErrorBoundary } from './block-error-boundary.tsx'
import type { ChatSessionProps } from './chat-session.tsx'
import { ClientOnly } from './client-only.tsx'

/** Esqueleto da conversa enquanto o código do chat carrega (fica no HTML estático). */
function ThreadSkeleton() {
  const t = useTranslations('chat')
  return (
    <div
      className="mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center gap-4 px-4 pb-16"
      aria-busy="true"
    >
      <span className="sr-only" role="status">
        {t('loading')}
      </span>
      <Skeleton className="size-11 rounded-xl" />
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-4 w-full max-w-sm" />
      <Skeleton className="mt-4 h-28 w-full rounded-2xl" />
    </div>
  )
}

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}

interface NewConversationAnchorProps {
  readonly reference: ReferenceInput | null
  /** Só o ícone (trilho do histórico recolhido e barra do celular), com o nome no `aria-label`. */
  readonly compact: boolean
}

function NewConversationAnchor({ reference, compact }: NewConversationAnchorProps) {
  const t = useTranslations('chat.thread')
  const locale = useLocale()
  const closeHistory = useCloseHistoryPanel()
  const href = newConversationHref(locale, reference) as Route
  if (compact) {
    return (
      <Link
        href={href}
        onClick={closeHistory}
        aria-label={t('newConversation')}
        title={t('newConversation')}
        className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
      >
        <SquarePenIcon aria-hidden="true" />
      </Link>
    )
  }
  return (
    <Link
      href={href}
      onClick={closeHistory}
      className={buttonVariants({ variant: 'outline', size: 'sm', className: 'w-full' })}
    >
      <SquarePenIcon aria-hidden="true" />
      {t('newConversation')}
    </Link>
  )
}

function NewConversationWithReference({ compact }: { readonly compact: boolean }) {
  const [{ ref }] = useQueryStates({ ref: chatSearchParams.ref })
  return <NewConversationAnchor reference={ref} compact={compact} />
}

/**
 * "Nova conversa": volta ao chat vazio, mantendo a data escolhida. Completo no topo do histórico;
 * só o ícone no trilho do histórico recolhido e na barra do celular. O `Suspense` é exigido pelo
 * `useQueryStates` no export estático (o HTML leva o link sem `ref`).
 */
function NewConversationLink({ compact = false }: { readonly compact?: boolean }) {
  return (
    <Suspense fallback={<NewConversationAnchor reference={null} compact={compact} />}>
      <NewConversationWithReference compact={compact} />
    </Suspense>
  )
}

/**
 * Ao fechar a citação com o foco dentro do painel (ou perdido), o foco volta ao chip ou à fonte que
 * a abriu: o painel some da árvore e o foco não pode ir junto.
 */
function returnFocusToCitation(citationId: string | undefined): void {
  const active = document.activeElement
  const lost =
    active === null || active === document.body || active.closest('[data-citation-panel]') !== null
  if (!lost || citationId === undefined) return
  const opener = document.querySelector<HTMLElement>(
    `[data-citation-id="${citationId}"][aria-pressed="true"], [data-source-id="${citationId}"][aria-pressed="true"]`,
  )
  requestAnimationFrame(() => {
    if (opener?.isConnected) opener.focus()
  })
}

/**
 * A conversa (useChat, Streamdown, AI SDK) e o painel de citação só existem em `/chat/` e carregam
 * sob demanda, fora do primeiro carregamento das páginas (orçamento de bundle).
 */
const ChatSession = lazy(() => import('./chat-session.tsx'))

const CitationPanel = lazy(() =>
  import('./citation-panel.tsx').then((module) => ({ default: module.CitationPanel })),
)

interface ChatSessionState {
  /** O `chatId` da sessão montada (a chave dela). */
  readonly id: string
  /** Veio da URL: a sessão relê a conversa do histórico. */
  readonly restore: boolean
}

interface ChatSessionHostProps
  extends Omit<ChatSessionProps, 'conversationId' | 'restoreConversation'> {
  /** A conversa montada mudou (outra do histórico ou uma nova): a citação aberta perde o sentido. */
  readonly onConversationChange: () => void
}

/**
 * Monta a `ChatSession` da conversa do `c` da URL: abrir outra conversa do histórico (ou voltar a
 * ela pelo navegador) monta uma sessão nova, que relê as perguntas dela; "Nova conversa" (sem `c`)
 * monta uma sessão vazia. Quando a própria sessão grava o `c` dela na URL, nada é remontado. Fica
 * dentro do `ClientOnly`: lê a URL só no navegador, sem `Suspense` no HTML estático.
 */
function ChatSessionHost({ onConversationChange, ...props }: ChatSessionHostProps) {
  const [{ c }] = useQueryStates({ c: chatSearchParams.c })
  const [session, setSession] = useState<ChatSessionState>(() => ({
    id: c ?? crypto.randomUUID(),
    restore: c !== null,
  }))
  const [previousC, setPreviousC] = useState(c)
  // Ajuste de estado no render (sem efeito): só quando o `c` da URL muda por fora da sessão.
  if (c !== previousC) {
    setPreviousC(c)
    if (c === null) {
      setSession({ id: crypto.randomUUID(), restore: false })
    } else if (c !== session.id) {
      setSession({ id: c, restore: true })
    }
  }
  const mounted = useRef(session.id)
  useEffect(() => {
    if (mounted.current === session.id) return
    mounted.current = session.id
    onConversationChange()
  }, [onConversationChange, session.id])
  return (
    <ChatSession
      key={session.id}
      conversationId={session.id}
      restoreConversation={session.restore}
      {...props}
    />
  )
}

/**
 * Área de trabalho do chat: histórico e conversa e, só com uma citação aberta, o painel dela. Guarda
 * a citação aberta (o painel e a conversa são irmãos), abre o painel ao lado da conversa (Drawer no
 * celular) e navega entre citações com `[`/`]`. O painel de histórico é a `ConversationList`, com
 * "Nova conversa" no topo; trocar de conversa fecha a citação aberta.
 */
export function ChatWorkspace() {
  const { composerBlocked } = useSession()
  const tChat = useTranslations('chat.thread')
  const [selection, setSelection] = useState<CitationSelection | null>(null)
  const [citationOpen, setCitationOpen] = useState(false)
  const closeCitation = useCallback(() => {
    setSelection(null)
    setCitationOpen(false)
  }, [])
  const selectedId = selectedCitation(selection)?.id
  const changeCitationOpen = useCallback(
    (open: boolean) => {
      if (!open) returnFocusToCitation(selectedId)
      setCitationOpen(open)
    },
    [selectedId],
  )

  const openCitation = useCallback(
    (
      citations: readonly Citation[],
      index: number,
      questionId: string | null,
      referenceDate: IsoDate | null,
    ) => {
      setSelection({ citations, index, questionId, referenceDate })
      setCitationOpen(true)
      const citation = citations[index]
      if (citation !== undefined) {
        analytics.capture('citation_opened', {
          doc_type: citation.family,
          version_is_current: citation.isCurrent,
        })
      }
    },
    [],
  )
  const step = useCallback((delta: -1 | 1) => {
    setSelection((current) => (current === null ? current : stepSelection(current, delta)))
  }, [])

  useEffect(() => {
    if (!citationOpen) return
    function onKeyDown(event: KeyboardEvent): void {
      const delta = citationStep(event)
      if (delta === 0 || isEditableTarget(event.target)) return
      event.preventDefault()
      step(delta)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [citationOpen, step])

  return (
    <Workspace
      history={<ConversationList variant="panel" />}
      historyActions={<NewConversationLink />}
      compactActions={<NewConversationLink compact />}
      citation={
        selection === null ? null : (
          <BlockErrorBoundary fallback={tChat('blockError')}>
            <ClientOnly fallback={<PanelSkeleton />}>
              <CitationPanel selection={selection} onStep={step} />
            </ClientOnly>
          </BlockErrorBoundary>
        )
      }
      citationOpen={citationOpen && selection !== null}
      onCitationOpenChange={changeCitationOpen}
    >
      <ClientOnly fallback={<ThreadSkeleton />}>
        <ChatSessionHost
          onConversationChange={closeCitation}
          onOpenCitation={openCitation}
          // A citação fechada deixa de marcar o chip; o Drawer guarda o conteúdo até sair da tela.
          selectedCitationId={citationOpen ? (selectedId ?? null) : null}
          // Sem sessão confirmada ou com o onboarding pendente, o composer fica travado.
          composerLocked={composerBlocked}
        />
      </ClientOnly>
    </Workspace>
  )
}
