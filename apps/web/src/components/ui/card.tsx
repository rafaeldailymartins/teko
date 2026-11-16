import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

const TONE_CLASSES = {
  /** Superfície padrão: borda fina e sombra leve. */
  default: 'border bg-popover shadow-soft',
  /** Destaque: borda mais clara, sombra em camadas e um leve gradiente no topo. */
  raised:
    'border border-border/70 bg-popover bg-linear-to-b from-surface/60 to-popover to-45% shadow-raised',
  /** Painel discreto, no tom do painel lateral. */
  muted: 'border bg-surface',
} as const

interface CardProps extends ComponentProps<'div'> {
  /** Elemento renderizado: `div` por padrão, ou `section` para um bloco com título. */
  readonly as?: 'div' | 'section'
  readonly tone?: keyof typeof TONE_CLASSES
}

/**
 * Cartão do design system (a base do `card` do shadcn, sem as partes que o Tekó não usa): cantos
 * `--radius-xl`, borda fina e sombra suave tingida de petróleo. O conteúdo define o próprio
 * espaçamento interno.
 */
export function Card({ as: Component = 'div', tone = 'default', className, ...props }: CardProps) {
  return (
    <Component
      data-slot="card"
      className={cn('rounded-xl text-popover-foreground', TONE_CLASSES[tone], className)}
      {...props}
    />
  )
}
