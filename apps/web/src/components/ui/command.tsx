'use client'

import { Command as CommandPrimitive } from 'cmdk'
import { SearchIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog.tsx'

/**
 * Command do shadcn (registry Base UI): lista filtrável do cmdk, com setas, `Enter` e busca por
 * texto. O campo de busca do registry usa o input-group; aqui ele vem embutido, que é o único uso.
 */
function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        'flex size-full flex-col overflow-hidden rounded-xl bg-popover p-1 text-popover-foreground',
        className,
      )}
      {...props}
    />
  )
}

interface CommandDialogProps extends Pick<ComponentProps<typeof Dialog>, 'open' | 'onOpenChange'> {
  /** Título e descrição para leitores de tela (o diálogo não tem cabeçalho visível). */
  readonly title: string
  readonly description: string
  readonly className?: string
  readonly children: ReactNode
}

function CommandDialog({ title, description, children, className, ...props }: CommandDialogProps) {
  return (
    <Dialog {...props}>
      <DialogContent
        className={cn(
          'top-1/3 translate-y-0 overflow-hidden rounded-xl p-0 sm:max-w-lg',
          className,
        )}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({ className, ...props }: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div data-slot="command-input-wrapper" className="p-1 pb-0">
      <div className="flex h-9 items-center gap-2 rounded-lg border border-input px-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <CommandPrimitive.Input
          data-slot="command-input"
          className={cn(
            'w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        />
      </div>
    </div>
  )
}

function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        'max-h-80 scroll-py-1 overflow-y-auto overflow-x-hidden outline-none',
        className,
      )}
      {...props}
    />
  )
}

function CommandEmpty({ className, ...props }: ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn('py-6 text-center text-muted-foreground text-sm', className)}
      {...props}
    />
  )
}

function CommandGroup({ className, ...props }: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        'overflow-hidden p-1 text-foreground **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground **:[[cmdk-group-heading]]:text-xs',
        className,
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn('-mx-1 h-px bg-border', className)}
      {...props}
    />
  )
}

function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex min-h-9 cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-hidden data-[disabled=true]:pointer-events-none data-[selected=true]:bg-muted data-[selected=true]:text-foreground data-[disabled=true]:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
}
