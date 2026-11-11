import type { ReactNode } from 'react'

const TONE_CLASSES = {
  accent: 'border-accent-border bg-accent text-accent-foreground',
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
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-medium text-sm ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  )
}
