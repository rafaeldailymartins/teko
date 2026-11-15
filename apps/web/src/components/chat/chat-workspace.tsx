'use client'

import type { Citation } from '@teko/shared/contracts'
import type { IsoDate } from '@teko/shared/vigencia'
import { useTranslations } from 'next-intl'
import { lazy, useCallback, useEffect, useState } from 'react'
import { Workspace } from '@/components/app-shell/workspace'
import { Skeleton } from '@/components/ui/skeleton'
import { type CitationSelection, selectedCitation, stepSelection } from '@/lib/chat/selection'
import { citationStep, isEditableTarget } from '@/lib/hotkeys'
import { BlockErrorBoundary } from './block-error-boundary.tsx'
import { ClientOnly } from './client-only.tsx'

/** Esqueleto da conversa enquanto o código do chat carrega (fica no HTML estático). */
function ThreadSkeleton() {
  const t = useTranslations('chat')
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 px-4 py-6" aria-busy="true">
      <span className="sr-only" role="status">
        {t('loading')}
      </span>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <div className="flex-1" />
      <Skeleton className="h-28 w-full rounded-xl" />
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

/**
 * A conversa (useChat, Streamdown, AI SDK) e o painel de citação só existem em `/chat/` e carregam
 * sob demanda, fora do primeiro carregamento das páginas (orçamento de bundle).
 */
const ChatSession = lazy(() => import('./chat-session.tsx'))

const CitationPanel = lazy(() =>
  import('./citation-panel.tsx').then((module) => ({ default: module.CitationPanel })),
)

/**
 * Área de trabalho do chat: histórico | conversa | citação. Guarda a citação aberta (o painel e a
 * conversa são irmãos), abre o Drawer da citação no celular e navega entre citações com `[`/`]`.
 * O painel de histórico é do agente de histórico; aqui fica o estado vazio.
 */
export function ChatWorkspace() {
  const tPanels = useTranslations('shell.panels')
  const tChat = useTranslations('chat.thread')
  const [selection, setSelection] = useState<CitationSelection | null>(null)
  const [citationOpen, setCitationOpen] = useState(false)

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
      history={<p className="px-4 pb-4 text-muted-foreground text-sm">{tPanels('historyEmpty')}</p>}
      citation={
        selection === null ? (
          <p className="px-4 pb-4 text-muted-foreground text-sm">{tPanels('citationEmpty')}</p>
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
        <ChatSession
          onOpenCitation={openCitation}
          selectedCitationId={selectedCitation(selection)?.id ?? null}
          // Onboarding da autenticação: ligar aqui o `useSession().composerBlocked`.
          composerLocked={false}
        />
      </ClientOnly>
    </Workspace>
  )
}
