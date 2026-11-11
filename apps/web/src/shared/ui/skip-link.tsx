interface SkipLinkProps {
  /** `id` do elemento de destino (sem `#`). */
  readonly targetId: string
  readonly children: string
}

/**
 * Primeiro elemento focável da página (WCAG 2.4.1): invisível até receber foco e então
 * fixado no topo, acima de qualquer cabeçalho (2.4.11, foco não encoberto).
 */
export function SkipLink({ targetId, children }: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg"
    >
      {children}
    </a>
  )
}
