import { CircleAlertIcon, CircleCheckIcon, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface SettingsSectionProps {
  /** Âncora da navegação lateral e base do `aria-labelledby` da seção. */
  readonly id: string
  readonly title: string
  readonly description?: string
  /** Ícone do título, num ladrilho (decorativo). */
  readonly icon?: LucideIcon
  /** `danger`: a zona de perigo, com borda e ladrilho destrutivos. */
  readonly tone?: 'default' | 'danger'
  /** Ação no canto do cabeçalho (sair, por exemplo). */
  readonly action?: ReactNode
  readonly children: ReactNode
}

/**
 * Bloco da página de configurações: cartão com o ícone num ladrilho, o título em serif (`h2`), a
 * descrição opcional e o conteúdo, separado do cabeçalho por um fio fino.
 */
export function SettingsSection({
  id,
  title,
  description,
  icon: Icon,
  tone = 'default',
  action,
  children,
}: SettingsSectionProps) {
  const danger = tone === 'danger'
  return (
    <Card
      as="section"
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn('flex flex-col', danger && 'border-destructive/35 shadow-none')}
    >
      <div className="flex items-start gap-3.5 p-5 sm:px-6">
        {Icon !== undefined && (
          <span
            aria-hidden="true"
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-lg border [&_svg]:size-[1.125rem]',
              danger
                ? 'border-destructive/25 bg-destructive/8 text-destructive'
                : 'border-leaf/30 bg-leaf-soft text-validity-current',
            )}
          >
            <Icon />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2
            id={`${id}-title`}
            className={cn(
              'font-semibold font-serif text-xl leading-tight tracking-tight',
              danger && 'text-destructive',
            )}
          >
            {title}
          </h2>
          {description !== undefined && (
            <p className="text-pretty text-muted-foreground leading-relaxed">{description}</p>
          )}
        </div>
        {action}
      </div>
      <div
        className={cn(
          'flex flex-col gap-4 border-t p-5 sm:px-6',
          danger && 'border-destructive/20',
        )}
      >
        {children}
      </div>
    </Card>
  )
}

/** Mensagem de erro de uma ação da seção (anunciada pelo leitor de tela). */
export function SectionError({ children }: { readonly children: ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 text-destructive text-sm">
      <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

/** Confirmação discreta de uma ação concluída. */
export function SectionStatus({ children }: { readonly children: ReactNode }) {
  return (
    <p role="status" className="flex items-start gap-2 text-muted-foreground text-sm">
      <CircleCheckIcon
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-validity-current"
      />
      <span>{children}</span>
    </p>
  )
}
