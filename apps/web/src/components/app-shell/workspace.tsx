'use client'

import { HistoryIcon, QuoteIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { createContext, type ReactNode, useContext, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { DESKTOP_MEDIA_QUERY, useMediaQuery } from './use-media-query.ts'

interface WorkspaceProps {
  /** Conteúdo do painel de histórico (conversas). */
  readonly history: ReactNode
  /** Ações no topo do painel de histórico ("Nova conversa"), no desktop e no Sheet do celular. */
  readonly historyActions?: ReactNode
  /** Conteúdo do painel de citação (dispositivo, versão, vigência). */
  readonly citation: ReactNode
  /** A conversa: o painel central, que nunca é desmontado ao trocar de layout. */
  readonly children: ReactNode
  /** Drawer da citação controlado por fora (abaixo de 768 px), para abrir ao clicar num chip. */
  readonly citationOpen?: boolean
  readonly onCitationOpenChange?: (open: boolean) => void
}

const noop = () => {}

/** Fecha o Sheet do histórico no celular (no desktop o painel fica aberto e nada acontece). */
const CloseHistoryContext = createContext<() => void>(noop)

/**
 * Para o conteúdo do histórico fechar o Sheet ao abrir uma conversa: a navegação só troca a query
 * (`?c=`), a página não muda e o Sheet ficaria aberto. Fora do workspace, não faz nada.
 */
export function useCloseHistoryPanel(): () => void {
  return useContext(CloseHistoryContext)
}

interface SidePanelProps {
  readonly title: string
  /** Ações abaixo do título, fora da rolagem. */
  readonly actions?: ReactNode
  readonly children: ReactNode
}

/** Painel lateral no desktop: uma região nomeada pelo título, com rolagem própria. */
function SidePanel({ title, actions, children }: SidePanelProps) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="flex h-full min-h-0 flex-col bg-surface">
      <h2
        id={titleId}
        className="shrink-0 px-4 pt-4 pb-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider"
      >
        {title}
      </h2>
      {actions !== undefined && <div className="shrink-0 px-3 pb-2">{actions}</div>}
      <ScrollArea className="min-h-0 flex-1">{children}</ScrollArea>
    </section>
  )
}

/**
 * Área de trabalho do chat em três painéis: histórico | conversa | citação. No desktop, os
 * separadores redimensionam por mouse e por teclado (setas, Home/End; Enter recolhe o painel).
 * Abaixo de 768 px só a conversa fica na tela: o histórico abre num Sheet e a citação num Drawer.
 *
 * O HTML estático sai com o layout de desktop, e uma regra CSS esconde os painéis laterais no
 * celular até a hidratação; a conversa fica sempre no mesmo lugar da árvore e não perde estado.
 */
export function Workspace({
  history,
  historyActions,
  citation,
  children,
  citationOpen: controlledCitationOpen,
  onCitationOpenChange,
}: WorkspaceProps) {
  const t = useTranslations('shell.panels')
  const tCommon = useTranslations('common')
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY, true)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [uncontrolledCitationOpen, setUncontrolledCitationOpen] = useState(false)
  const citationOpen = controlledCitationOpen ?? uncontrolledCitationOpen
  const setCitationOpen = onCitationOpenChange ?? setUncontrolledCitationOpen
  const closeHistory = () => setHistoryOpen(false)

  return (
    <CloseHistoryContext value={closeHistory}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-surface px-3 py-2 md:hidden">
          <Sheet open={historyOpen && !isDesktop} onOpenChange={setHistoryOpen}>
            <SheetTrigger render={<Button variant="outline" size="sm" />}>
              <HistoryIcon aria-hidden="true" />
              {t('history')}
            </SheetTrigger>
            <SheetContent side="left" closeLabel={tCommon('close')}>
              <SheetHeader>
                <SheetTitle>{t('history')}</SheetTitle>
              </SheetHeader>
              {historyActions !== undefined && <div className="px-4 pb-2">{historyActions}</div>}
              <ScrollArea className="min-h-0 flex-1">{history}</ScrollArea>
            </SheetContent>
          </Sheet>
          <Drawer open={citationOpen && !isDesktop} onOpenChange={setCitationOpen}>
            <DrawerTrigger render={<Button variant="outline" size="sm" />}>
              <QuoteIcon aria-hidden="true" />
              {t('citation')}
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>{t('citation')}</DrawerTitle>
              </DrawerHeader>
              <div className="min-h-0 overflow-y-auto pb-6">{citation}</div>
            </DrawerContent>
          </Drawer>
        </div>

        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1 max-md:[&>:not(:has([data-workspace-thread]))]:hidden"
        >
          {isDesktop && (
            <ResizablePanel id="history" defaultSize="22%" minSize="15%" maxSize="35%" collapsible>
              <SidePanel title={t('history')} actions={historyActions}>
                {history}
              </SidePanel>
            </ResizablePanel>
          )}
          {isDesktop && <ResizableHandle withHandle aria-label={t('resizeHistory')} />}
          <ResizablePanel id="thread" minSize="35%">
            {/* `data-workspace-thread`: a regra CSS do grupo esconde os outros painéis no celular. */}
            <div data-workspace-thread="" className="h-full min-h-0 overflow-y-auto">
              {children}
            </div>
          </ResizablePanel>
          {isDesktop && <ResizableHandle withHandle aria-label={t('resizeCitation')} />}
          {isDesktop && (
            <ResizablePanel id="citation" defaultSize="28%" minSize="20%" maxSize="45%" collapsible>
              <SidePanel title={t('citation')}>{citation}</SidePanel>
            </ResizablePanel>
          )}
        </ResizablePanelGroup>
      </div>
    </CloseHistoryContext>
  )
}
