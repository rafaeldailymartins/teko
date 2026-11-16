import type { ReactNode } from 'react'
import { MAIN_CONTENT_ID } from '@/lib/site'
import { TekoLogo } from './teko-logo.tsx'

interface BrandScreenProps {
  /** Texto do estado (anunciado pelo leitor de tela). */
  readonly label: string
  /** Mostra a linha do tempo animada: o estado ainda está andando (carregando, redirecionando). */
  readonly busy?: boolean
  /** Conteúdo abaixo do texto (uma ação, por exemplo). */
  readonly children?: ReactNode
}

/**
 * Tela da marca, de página inteira: o selo da logo sobre o brilho do petróleo e, enquanto algo
 * carrega, a linha do tempo com o ponto âmbar indo e voltando (só com CSS; com movimento reduzido,
 * o ponto fica parado). É o que o grupo `(app)` mostra enquanto confere a sessão, inclusive no HTML
 * estático, antes da hidratação.
 */
export function BrandScreen({ label, busy = false, children }: BrandScreenProps) {
  return (
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      aria-busy={busy}
      className="flex min-h-dvh flex-col items-center justify-center gap-7 bg-brand-glow px-5 py-16 text-center focus:outline-none"
    >
      <div className="relative">
        {busy && (
          <span
            aria-hidden="true"
            className="absolute -inset-2.5 rounded-[1.6rem] border border-leaf/35 motion-safe:animate-[ping_2.2s_var(--ease-out-soft)_infinite]"
          />
        )}
        <TekoLogo variant="seal" className="size-16 rounded-[1.1rem] shadow-raised" />
      </div>
      {busy && (
        <div aria-hidden="true" className="timeline-rule relative h-px w-44">
          <span className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-date-mark shadow-[0_0_0_3px_var(--background)] motion-safe:left-0 motion-safe:translate-x-0 motion-safe:animate-timeline" />
        </div>
      )}
      <div className="flex max-w-sm flex-col items-center gap-4">
        <p role="status" className="text-pretty text-muted-foreground text-sm">
          {label}
        </p>
        {children}
      </div>
    </main>
  )
}
