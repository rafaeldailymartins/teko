'use client'

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { cn } from '@/lib/utils'

/**
 * Abas do Base UI no acabamento do Tekó: a lista é um controle segmentado (trilho em `--muted`, a
 * aba ativa em relevo, como a aba da página atual no app), com setas entre as abas e `Enter` ou
 * espaço para ativar.
 */
function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-5', className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'grid auto-cols-fr grid-flow-col gap-1 rounded-xl border bg-muted p-1',
        className,
      )}
      {...props}
    />
  )
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 font-medium text-muted-foreground text-sm outline-none transition-[color,background-color,box-shadow] duration-150 ease-out-soft hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-active:bg-popover data-active:text-foreground data-active:shadow-soft',
        className,
      )}
      {...props}
    />
  )
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      className={cn('outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsPanel, TabsTab }
