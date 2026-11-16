import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface AppPageHeaderProps {
  /** Rótulo curto acima do título (a seção do app). */
  readonly eyebrow?: ReactNode
  readonly title: ReactNode
  readonly description?: ReactNode
  /** Ações à direita do título (no celular, abaixo dele). */
  readonly actions?: ReactNode
  /** `lang` do título (o rótulo de um dispositivo é sempre `pt-BR`). */
  readonly titleLang?: string
  readonly className?: string
}

/**
 * Cabeçalho das páginas internas do app (histórico, dispositivo, comparação): o rótulo da seção
 * com o marcador verde-folha da linha do tempo, o título em serif, a descrição e as ações, e o fio
 * da logo embaixo.
 */
export function AppPageHeader({
  eyebrow,
  title,
  description,
  actions,
  titleLang,
  className,
}: AppPageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-5', className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2.5">
          {eyebrow !== undefined && (
            <p className="inline-flex items-center gap-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-leaf" />
              {eyebrow}
            </p>
          )}
          <h1
            lang={titleLang}
            className="text-balance font-semibold font-serif text-[2rem] leading-tight tracking-tight sm:text-[2.5rem]"
          >
            {title}
          </h1>
          {description !== undefined && (
            <p className="max-w-2xl text-pretty text-[0.9375rem] text-muted-foreground leading-relaxed">
              {description}
            </p>
          )}
        </div>
        {actions !== undefined && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      <div aria-hidden="true" className="timeline-rule h-px w-full" />
    </header>
  )
}
