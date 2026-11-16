import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

const TONE_CLASSES = {
  /** Data de referência e vigência (âmbar). */
  accent: 'border-accent-border bg-accent text-accent-foreground',
  /** O que está vigente e os detalhes vivos (verde-folha). */
  leaf: 'border-leaf/50 bg-leaf-soft text-validity-current',
  neutral: 'border-border bg-surface text-muted-foreground',
} as const

const SIZE_CLASSES = {
  default: 'gap-2 px-3 py-1 text-sm shadow-soft',
  /** Compacto, para cabeçalhos de resposta e listas (sem sombra). */
  sm: 'gap-1.5 px-2 py-0.5 text-xs',
} as const

interface BadgeProps extends Omit<ComponentProps<'span'>, 'children'> {
  readonly tone?: keyof typeof TONE_CLASSES
  readonly size?: keyof typeof SIZE_CLASSES
  readonly children: ReactNode
}

/** Rótulo curto de status (não interativo). */
export function Badge({
  tone = 'neutral',
  size = 'default',
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium',
        SIZE_CLASSES[size],
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}
