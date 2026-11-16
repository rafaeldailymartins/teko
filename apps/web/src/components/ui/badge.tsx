import type { ReactNode } from 'react'

const TONE_CLASSES = {
  /** Data de referência e vigência (âmbar). */
  accent: 'border-accent-border bg-accent text-accent-foreground',
  /** O que está vigente e os detalhes vivos (verde-folha). */
  leaf: 'border-leaf/50 bg-leaf-soft text-validity-current',
  neutral: 'border-border bg-surface text-muted-foreground',
} as const

interface BadgeProps {
  readonly tone?: keyof typeof TONE_CLASSES
  readonly children: ReactNode
}

/** Rótulo curto de status (não interativo). */
export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-medium text-sm shadow-soft ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  )
}
