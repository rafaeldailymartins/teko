import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  /** Ícone decorativo (fica `aria-hidden`). */
  readonly icon: ReactNode
  readonly title: string
  /** Frase opcional do que vai aparecer ali. */
  readonly children?: ReactNode
  /** Nível do título: 1 quando o estado vazio é o conteúdo principal da página. */
  readonly headingLevel?: 1 | 2 | 3
  readonly className?: string
}

/** Estado vazio de uma página ou painel: ícone, título e, se houver, uma frase do que vai aparecer ali. */
export function EmptyState({
  icon,
  title,
  children,
  headingLevel = 2,
  className,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-full bg-muted text-primary [&_svg]:size-6"
      >
        {icon}
      </span>
      <Heading className="font-semibold font-serif text-xl tracking-tight">{title}</Heading>
      {children !== undefined && (
        <p className="max-w-md text-pretty text-muted-foreground leading-relaxed">{children}</p>
      )}
    </div>
  )
}
