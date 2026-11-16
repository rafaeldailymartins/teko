'use client'

import { HistoryIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  createContext,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { readHistoryCollapsed, writeHistoryCollapsed } from '@/lib/history-panel'
import { DESKTOP_MEDIA_QUERY, useMediaQuery } from './use-media-query.ts'

interface WorkspaceProps {
  /** Conteúdo do painel de histórico (conversas). */
  readonly history: ReactNode
  /** Ações no topo do painel de histórico ("Nova conversa"), no desktop e no Sheet do celular. */
  readonly historyActions?: ReactNode
  /** As mesmas ações só com ícone: no trilho do histórico recolhido e na barra do celular. */
  readonly compactActions?: ReactNode
  /** Conteúdo do painel de citação (dispositivo, versão, vigência). */
  readonly citation: ReactNode
  /** O painel de citação só existe aberto: ao lado da conversa no desktop, num Drawer no celular. */
  readonly citationOpen: boolean
  readonly onCitationOpenChange: (open: boolean) => void
  /** A conversa: o painel central, que nunca é desmontado ao trocar de layout. */
  readonly children: ReactNode
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

interface HistoryPanelProps {
  readonly actions?: ReactNode
  readonly onCollapse: () => void
  readonly toggleRef: Ref<HTMLButtonElement>
  readonly children: ReactNode
}

/** Histórico aberto no desktop: título, recolher, "Nova conversa" e a lista com rolagem própria. */
function HistoryPanel({ actions, onCollapse, toggleRef, children }: HistoryPanelProps) {
  const t = useTranslations('shell.panels')
  const titleId = useId()
  return (
    <section
      aria-labelledby={titleId}
      className="flex h-full w-64 shrink-0 flex-col border-r bg-surface max-md:hidden lg:w-72"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 py-2 pr-2 pl-4">
        <h2
          id={titleId}
          className="font-semibold text-muted-foreground text-xs uppercase tracking-wider"
        >
          {t('history')}
        </h2>
        <Button
          ref={toggleRef}
          variant="ghost"
          size="icon-sm"
          aria-label={t('collapseHistory')}
          aria-expanded={true}
          title={t('collapseHistory')}
          onClick={onCollapse}
        >
          <PanelLeftCloseIcon aria-hidden="true" />
        </Button>
      </div>
      {actions !== undefined && <div className="shrink-0 px-3 pb-2">{actions}</div>}
      <ScrollArea className="min-h-0 flex-1">{children}</ScrollArea>
    </section>
  )
}

interface HistoryRailProps {
  readonly actions?: ReactNode
  readonly onExpand: () => void
  readonly toggleRef: Ref<HTMLButtonElement>
}

/** Histórico recolhido: um trilho estreito com o botão de abrir e o atalho de nova conversa. */
function HistoryRail({ actions, onExpand, toggleRef }: HistoryRailProps) {
  const t = useTranslations('shell.panels')
  return (
    <div className="flex h-full w-12 shrink-0 flex-col items-center gap-1 border-r bg-surface py-2 max-md:hidden">
      <Button
        ref={toggleRef}
        variant="ghost"
        size="icon-sm"
        aria-label={t('expandHistory')}
        aria-expanded={false}
        title={t('expandHistory')}
        onClick={onExpand}
      >
        <PanelLeftOpenIcon aria-hidden="true" />
      </Button>
      {actions}
    </div>
  )
}

interface CitationSidePanelProps {
  readonly onClose: () => void
  readonly children: ReactNode
}

/** Citação aberta no desktop: região nomeada, com o botão de fechar e rolagem própria. */
function CitationSidePanel({ onClose, children }: CitationSidePanelProps) {
  const t = useTranslations('shell.panels')
  const titleId = useId()
  return (
    <section
      aria-labelledby={titleId}
      data-citation-panel=""
      className="flex h-full min-h-0 flex-col bg-surface"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 py-2 pr-2 pl-4">
        <h2
          id={titleId}
          className="font-semibold text-muted-foreground text-xs uppercase tracking-wider"
        >
          {t('citation')}
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('closeCitation')}
          aria-keyshortcuts="Escape"
          title={`${t('closeCitation')} (Esc)`}
          onClick={onClose}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">{children}</ScrollArea>
    </section>
  )
}

/**
 * `Esc` fecha a citação aberta no desktop quando o foco está no painel, num chip ou numa fonte da
 * resposta (ou em lugar nenhum). Com o foco no composer, o `Esc` é dele (parar a resposta), e quem
 * já tratou a tecla (`defaultPrevented`) também fica de fora; o ouvinte fica na `window` para
 * correr depois dos do `document`.
 */
function useEscapeCloses(active: boolean, onOpenChange: (open: boolean) => void): void {
  useEffect(() => {
    if (!active) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const { target } = event
      const relevant =
        target === document.body ||
        (target instanceof Element &&
          target.closest('[data-citation-panel], [data-citation-id], [data-source-id]') !== null)
      if (!relevant) return
      event.preventDefault()
      onOpenChange(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, onOpenChange])
}

/**
 * Área de trabalho do chat, com duas colunas no máximo. No desktop: o histórico (recolhível, com a
 * escolha lembrada; recolhido, vira um trilho com o atalho de nova conversa) e a conversa; ao abrir
 * uma citação, o painel dela entra à direita da conversa, redimensionável pelo separador (mouse e
 * teclado), e o histórico dá lugar ao trilho até a citação fechar (botão ou `Esc`). Abaixo de
 * 768 px só a conversa fica na tela: o histórico abre num Sheet e a citação num Drawer.
 *
 * O HTML estático sai com o layout de desktop, e regras CSS escondem o histórico e a citação no
 * celular até a hidratação; a conversa fica sempre no mesmo lugar da árvore e não perde estado.
 */
export function Workspace({
  history,
  historyActions,
  compactActions,
  citation,
  citationOpen,
  onCitationOpenChange,
  children,
}: WorkspaceProps) {
  const t = useTranslations('shell.panels')
  const tCommon = useTranslations('common')
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY, true)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(readHistoryCollapsed)
  const focusToggle = useRef(false)
  // Recolher e abrir trocam o botão de lugar: o foco acompanha o botão novo quando ele monta.
  const toggleRef = useCallback((node: HTMLButtonElement | null) => {
    if (node === null || !focusToggle.current) return
    focusToggle.current = false
    node.focus()
  }, [])
  const closeHistory = () => setHistoryOpen(false)
  const closeCitation = () => onCitationOpenChange(false)
  const showHistory = !collapsed && !citationOpen

  useEscapeCloses(isDesktop && citationOpen, onCitationOpenChange)

  function setHistoryCollapsed(next: boolean): void {
    focusToggle.current = true
    setCollapsed(next)
    writeHistoryCollapsed(next)
  }

  function expandHistory(): void {
    // Duas colunas no máximo: abrir o histórico fecha a citação.
    if (citationOpen) closeCitation()
    setHistoryCollapsed(false)
  }

  return (
    <CloseHistoryContext value={closeHistory}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-surface px-3 py-1.5 md:hidden">
          <Sheet open={historyOpen && !isDesktop} onOpenChange={setHistoryOpen}>
            <SheetTrigger render={<Button variant="ghost" size="sm" />}>
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
          {compactActions}
          <Drawer open={citationOpen && !isDesktop} onOpenChange={onCitationOpenChange}>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>{t('citation')}</DrawerTitle>
              </DrawerHeader>
              <div className="min-h-0 overflow-y-auto pb-6">{citation}</div>
            </DrawerContent>
          </Drawer>
        </div>

        <div className="flex min-h-0 flex-1">
          {isDesktop &&
            (showHistory ? (
              <HistoryPanel
                actions={historyActions}
                onCollapse={() => setHistoryCollapsed(true)}
                toggleRef={toggleRef}
              >
                {history}
              </HistoryPanel>
            ) : (
              <HistoryRail
                actions={compactActions}
                onExpand={expandHistory}
                toggleRef={toggleRef}
              />
            ))}
          <ResizablePanelGroup
            orientation="horizontal"
            className="min-h-0 min-w-0 flex-1 max-md:[&>:not(:has([data-workspace-thread]))]:hidden"
          >
            <ResizablePanel id="thread" minSize="40%">
              {/* `data-workspace-thread`: a regra CSS do grupo esconde a citação no celular. */}
              <div data-workspace-thread="" className="h-full min-h-0 scroll-pb-44 overflow-y-auto">
                {children}
              </div>
            </ResizablePanel>
            {isDesktop && citationOpen && (
              <ResizableHandle withHandle aria-label={t('resizeCitation')} />
            )}
            {isDesktop && citationOpen && (
              <ResizablePanel id="citation" defaultSize="40%" minSize="28%" maxSize="55%">
                <CitationSidePanel onClose={closeCitation}>{citation}</CitationSidePanel>
              </ResizablePanel>
            )}
          </ResizablePanelGroup>
        </div>
      </div>
    </CloseHistoryContext>
  )
}
