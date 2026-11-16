'use client'

import type { Citation } from '@teko/shared/contracts'
import type { IsoDate, ReferenceInput } from '@teko/shared/vigencia'
import { QuoteIcon, SquarePenIcon } from 'lucide-react'
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
      className="mx-auto flex h-full w-full max-w-3xl flex-col items-center gap-5 px-4 pt-16"
      aria-busy="true"
    >
      <span className="sr-only" role="status">
        {t('loading')}
      </span>
      <Skeleton className="size-14 rounded-2xl" />
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-4 w-full max-w-md" />
      <Skeleton className="h-8 w-32 rounded-full" />
      <div className="flex-1" />
      <Skeleton className="mb-4 h-28 w-full rounded-2xl" />
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

/** Painel de citação vazio: o que vai aparecer ali, com o ícone da citação. */
function CitationEmpty() {
  const t = useTranslations('shell.panels')
  return (
    <div className="flex flex-col items-start gap-3 px-4 pt-2 pb-6">
      <span
        aria-hidden="true"
        className="flex size-9 items-center justify-center rounded-xl bg-muted text-primary"
      >
        <QuoteIcon className="size-4" />
      </span>
      <p className="text-muted-foreground text-sm leading-relaxed">{t('citationEmpty')}</p>
      <div aria-hidden="true" className="flex w-full flex-col gap-2 border-l border-dashed pl-4">
        {['w-3/4', 'w-1/2', 'w-2/3'].map((width) => (
          <span key={width} className="relative block">
            <span className="absolute top-1/2 -left-[1.3rem] size-2 -translate-y-1/2 rounded-full border border-border-strong/60 bg-background" />
            <span className={`block h-2 rounded-full bg-muted ${width}`} />
          </span>
        ))}
      </div>
    </div>
  )
}

function NewConversationAnchor({ reference }: { readonly reference: ReferenceInput | null }) {
  const t = useTranslations('chat.thread')
  const locale = useLocale()
  const closeHistory = useCloseHistoryPanel()
  return (
    <Link
      href={newConversationHref(locale, reference) as Route}
      onClick={closeHistory}
      className={buttonVariants({ variant: 'outline', size: 'sm', className: 'w-full' })}
    >
      <SquarePenIcon aria-hidden="true" />
      {t('newConversation')}
    </Link>
  )
}

function NewConversationWithReference() {
  const [{ ref }] = useQueryStates({ ref: chatSearchParams.ref })
  return <NewConversationAnchor reference={ref} />
}

/**
 * "Nova conversa" no topo do painel de histórico: volta ao chat vazio, mantendo a data escolhida.
 * O `Suspense` é exigido pelo `useQueryStates` no export estático (o HTML leva o link sem `ref`).
 */
function NewConversationLink() {
  return (
    <Suspense fallback={<NewConversationAnchor reference={null} />}>
      <NewConversationWithReference />
    </Suspense>
  )
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
 * Área de trabalho do chat: histórico | conversa | citação. Guarda a citação aberta (o painel e a
 * conversa são irmãos), abre o Drawer da citação no celular e navega entre citações com `[`/`]`.
 * O painel de histórico é a `ConversationList`, com "Nova conversa" no topo; trocar de conversa
 * fecha a citação aberta.
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

  const openCitation = useCallback(
    (
      citations: readonly Citation[],
      index: number,
      questionId: string | null,
      referenceDate: IsoDate | null,
    ) => {
      setSelection({ citations, index, questionId, referenceDate })
      setCitationOpen(true)
    },
    [],
  )
  const step = useCallback((delta: -1 | 1) => {
    setSelection((current) => (current === null ? current : stepSelection(current, delta)))
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const delta = citationStep(event)
      if (delta === 0 || isEditableTarget(event.target)) return
      event.preventDefault()
      step(delta)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [step])

  return (
    <Workspace
      history={<ConversationList variant="panel" />}
      historyActions={<NewConversationLink />}
      citation={
        selection === null ? (
          <CitationEmpty />
        ) : (
          <BlockErrorBoundary fallback={tChat('blockError')}>
            <ClientOnly fallback={<PanelSkeleton />}>
              <CitationPanel selection={selection} onStep={step} />
            </ClientOnly>
          </BlockErrorBoundary>
        )
      }
      citationOpen={citationOpen}
      onCitationOpenChange={setCitationOpen}
    >
      <ClientOnly fallback={<ThreadSkeleton />}>
        <ChatSessionHost
          onConversationChange={closeCitation}
          onOpenCitation={openCitation}
          selectedCitationId={selectedCitation(selection)?.id ?? null}
          // Sem sessão confirmada ou com o onboarding pendente, o composer fica travado.
          composerLocked={composerBlocked}
        />
      </ClientOnly>
    </Workspace>
  )
}
