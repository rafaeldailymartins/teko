import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** Bloco de carregamento (registry `base-nova`); decorativo, quem o usa anuncia o estado. */
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
