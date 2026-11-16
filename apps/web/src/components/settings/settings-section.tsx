import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'

interface SettingsSectionProps {
  /** Âncora e `aria-labelledby` da seção. */
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly children: ReactNode
}

/** Bloco da página de configurações: título (`h2`), descrição opcional e o conteúdo. */
export function SettingsSection({ id, title, description, children }: SettingsSectionProps) {
  return (
    <Card as="section" aria-labelledby={`${id}-title`} className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="font-semibold font-serif text-lg tracking-tight">
          {title}
        </h2>
        {description !== undefined && (
          <p className="text-pretty text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </Card>
  )
}

/** Mensagem de erro de uma ação da seção (anunciada pelo leitor de tela). */
export function SectionError({ children }: { readonly children: ReactNode }) {
  return (
    <p role="alert" className="text-destructive text-sm">
      {children}
    </p>
  )
}

/** Confirmação discreta de uma ação concluída. */
export function SectionStatus({ children }: { readonly children: ReactNode }) {
  return (
    <p role="status" className="text-muted-foreground text-sm">
      {children}
    </p>
  )
}
