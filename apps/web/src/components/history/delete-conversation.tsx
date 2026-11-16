'use client'

import { ErrorCode } from '@teko/shared/errors'
import {
  CircleAlertIcon,
  CircleCheckIcon,
  EllipsisIcon,
  InfoIcon,
  LoaderCircleIcon,
  Trash2Icon,
} from 'lucide-react'
import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { type RefObject, useEffect, useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ApiError } from '@/lib/api/errors'
import { useDeleteConversation } from '@/lib/api/hooks'
import { cn } from '@/lib/utils'

/** Quanto tempo o aviso "Conversa excluída" fica na tela. */
const NOTICE_MS = 6000

/** Atributo de cada link de conversa, para o foco achar a vizinha depois de uma exclusão. */
export const CONVERSATION_LINK_ATTRIBUTE = 'data-conversation-link'

/** Conversa a excluir: o que o diálogo mostra e para onde a tela vai depois. */
export interface DeletionTarget {
  readonly conversationId: string
  readonly title: string
  /** O botão "⋯" que abriu o menu: o foco volta a ele se a exclusão for cancelada. */
  readonly trigger: HTMLElement | null
  /** Conversa vizinha na lista, que recebe o foco depois da exclusão (`null` se era a única). */
  readonly neighborId: string | null
  /** Era a conversa aberta no chat: depois de excluir, a tela vai para este chat vazio. */
  readonly leaveTo: string | null
}

interface ConversationActionsProps {
  readonly title: string
  readonly variant: 'panel' | 'page'
  readonly onDelete: (trigger: HTMLElement | null) => void
}

/**
 * Menu discreto "⋯" de uma conversa do histórico. Aparece no hover e no foco da linha e fica
 * sempre visível no toque (sem hover); aberto, também fica. Por ora, só "Excluir conversa".
 */
export function ConversationActions({ title, variant, onDelete }: ConversationActionsProps) {
  const t = useTranslations('history.actions')
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        ref={triggerRef}
        aria-label={t('menu', { title })}
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(
              'absolute text-muted-foreground opacity-0 transition-[opacity,background-color,color] duration-150 hover:text-foreground focus-visible:opacity-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100 data-popup-open:bg-muted data-popup-open:text-foreground data-popup-open:opacity-100 pointer-coarse:opacity-100',
              variant === 'panel'
                ? 'top-1.5 right-1.5 size-7'
                : 'top-1/2 right-10 -translate-y-1/2',
            )}
          />
        }
      >
        <EllipsisIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem variant="destructive" onClick={() => onDelete(triggerRef.current)}>
          <Trash2Icon aria-hidden="true" />
          {t('delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface DeleteConversationDialogProps {
  readonly target: DeletionTarget | null
  readonly onClose: () => void
  /** A exclusão terminou: a lista já não tem a conversa. */
  readonly onDeleted: () => void
  /** Recebe o foco quando não há conversa vizinha (a lista ficou vazia). */
  readonly fallbackFocus: RefObject<HTMLElement | null>
}

/**
 * Confirmação da exclusão, com o título da conversa e o aviso de que não dá para desfazer. Enquanto
 * a API responde, o diálogo não fecha. Depois de excluir, o foco vai para a conversa vizinha (ou
 * para a lista, se ela ficou vazia) e, se a conversa estava aberta, a tela volta ao chat vazio;
 * cancelado, o foco volta ao "⋯". Uma resposta ainda em andamento na conversa dá uma mensagem
 * própria (409 `stream_busy`).
 */
export function DeleteConversationDialog({
  target,
  onClose,
  onDeleted,
  fallbackFocus,
}: DeleteConversationDialogProps) {
  const t = useTranslations('history.delete')
  const tRoot = useTranslations()
  const router = useRouter()
  const deletion = useDeleteConversation()
  const deleted = useRef(false)
  // O diálogo fecha com animação: o conteúdo continua o da conversa até sumir.
  const [shown, setShown] = useState<DeletionTarget | null>(target)
  if (target !== null && target !== shown) {
    setShown(target)
  }

  const close = () => {
    if (!deletion.isPending) {
      onClose()
    }
  }

  const confirm = () => {
    if (target === null) {
      return
    }
    deleted.current = false
    deletion.mutate(target.conversationId, {
      onSuccess: () => {
        deleted.current = true
        if (target.leaveTo !== null) {
          router.replace(target.leaveTo as Route)
        }
        onDeleted()
        onClose()
      },
    })
  }

  const error = deletion.error
  const message =
    error === null
      ? null
      : error instanceof ApiError && error.code === ErrorCode.StreamBusy
        ? t('busy')
        : tRoot(error instanceof ApiError ? error.messageKey : 'errors.internal')

  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          close()
        }
      }}
      onOpenChangeComplete={(open) => {
        if (!open) {
          deletion.reset()
        }
      }}
    >
      <AlertDialogContent
        finalFocus={() => {
          if (!deleted.current) {
            return shown?.trigger ?? true
          }
          const neighborId = shown?.neighborId ?? null
          const neighbor =
            neighborId === null
              ? null
              : document.querySelector<HTMLElement>(
                  `[${CONVERSATION_LINK_ATTRIBUTE}="${neighborId}"]`,
                )
          return neighbor ?? fallbackFocus.current ?? true
        }}
      >
        <div className="flex gap-3.5">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive"
          >
            <Trash2Icon className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col gap-2 pt-0.5">
            <AlertDialogTitle>{t('title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('body', { title: shown?.title ?? '' })}
            </AlertDialogDescription>
          </div>
        </div>
        <p className="flex items-start gap-2 rounded-lg bg-muted/70 px-3 py-2.5 text-muted-foreground text-xs leading-relaxed">
          <InfoIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          {t('quota')}
        </p>
        {message !== null && (
          <p role="alert" className="flex items-start gap-2 text-destructive text-sm">
            <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {message}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogClose disabled={deletion.isPending} render={<Button variant="ghost" />}>
            {t('cancel')}
          </AlertDialogClose>
          <Button variant="destructive" disabled={deletion.isPending} onClick={confirm}>
            {deletion.isPending ? (
              <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
            ) : (
              <Trash2Icon aria-hidden="true" />
            )}
            {deletion.isPending ? t('deleting') : t('confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Aviso discreto da exclusão: uma região `aria-live` que existe sempre (para o leitor de tela
 * anunciar quando o texto chega) e some sozinha depois de alguns segundos. O Tekó não tem toasts;
 * o aviso fica no topo da própria lista.
 */
export function DeletionNotice({
  stamp,
  variant,
}: {
  /** Muda a cada exclusão (0 = nenhuma ainda). */
  readonly stamp: number
  readonly variant: 'panel' | 'page'
}) {
  const t = useTranslations('history.delete')
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (stamp === 0) {
      return
    }
    setVisible(true)
    const timer = window.setTimeout(() => setVisible(false), NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [stamp])
  return (
    <div aria-live="polite" aria-atomic="true" className={cn(variant === 'panel' && 'px-2')}>
      {visible && (
        <p
          className={cn(
            'fade-in-0 slide-in-from-top-1 flex animate-in items-center gap-2 rounded-lg border bg-popover px-3 py-2 text-foreground text-sm shadow-soft duration-200',
            variant === 'panel' ? 'mb-2' : 'mb-4',
          )}
        >
          <CircleCheckIcon aria-hidden="true" className="size-4 shrink-0 text-validity-current" />
          {t('done')}
        </p>
      )}
    </div>
  )
}
