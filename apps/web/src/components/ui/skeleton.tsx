import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** Skeleton do shadcn: bloco pulsante no lugar do conteúdo que ainda carrega (decorativo). */
function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  )
}

export { Skeleton }
