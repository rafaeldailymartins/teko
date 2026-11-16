'use client'

import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * Diálogo de confirmação (Base UI Alert Dialog, `role="alertdialog"`): pede uma decisão antes de
 * uma ação que não se desfaz. Diferente do `Dialog`, clicar fora não fecha; `Esc` e "Cancelar"
 * fecham, e o foco volta ao gatilho ou ao `finalFocus` do `AlertDialogContent`. Mesma aparência do
 * `Dialog`.
 */
function AlertDialog(props: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogContent({ className, children, ...props }: AlertDialogPrimitive.Popup.Props) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal">
      <AlertDialogPrimitive.Backdrop
        data-slot="alert-dialog-overlay"
        className="data-closed:fade-out-0 data-open:fade-in-0 fixed inset-0 isolate z-50 bg-[oklch(0.16_0.035_216/0.45)] duration-150 supports-backdrop-filter:backdrop-blur-sm data-closed:animate-out data-open:animate-in"
      />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        className={cn(
          'data-closed:fade-out-0 data-closed:zoom-out-95 data-open:fade-in-0 data-open:zoom-in-95 fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl bg-popover p-5 text-popover-foreground text-sm shadow-overlay outline-none ring-1 ring-border duration-150 ease-out-soft data-closed:animate-out data-open:animate-in sm:max-w-md',
          className,
        )}
        {...props}
      >
        {children}
      </AlertDialogPrimitive.Popup>
    </AlertDialogPrimitive.Portal>
  )
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn('font-semibold font-serif text-xl leading-tight tracking-tight', className)}
      {...props}
    />
  )
}

function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn('text-pretty text-muted-foreground text-sm leading-relaxed', className)}
      {...props}
    />
  )
}

/** Rodapé com as ações: empilhadas no celular (a principal em cima), em linha à direita no resto. */
function AlertDialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

/** Fecha o diálogo (o "Cancelar"); com `render`, vira o botão do Tekó. */
function AlertDialogClose(props: AlertDialogPrimitive.Close.Props) {
  return <AlertDialogPrimitive.Close data-slot="alert-dialog-close" {...props} />
}

export {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
}
