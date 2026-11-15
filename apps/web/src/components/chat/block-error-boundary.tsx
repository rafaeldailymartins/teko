'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface BlockErrorBoundaryProps {
  /** Mensagem no lugar do bloco que falhou (texto já traduzido). */
  readonly fallback: ReactNode
  readonly children: ReactNode
}

interface BlockErrorBoundaryState {
  readonly failed: boolean
}

/**
 * `ErrorBoundary` por bloco do chat (cada mensagem, o markdown, o painel de citação): um dado
 * inesperado derruba só aquele bloco, e a conversa continua utilizável.
 */
export class BlockErrorBoundary extends Component<
  BlockErrorBoundaryProps,
  BlockErrorBoundaryState
> {
  override state: BlockErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): BlockErrorBoundaryState {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Falha ao renderizar um bloco do chat', error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <p
          role="alert"
          className="rounded-lg border border-dashed p-3 text-muted-foreground text-sm"
        >
          {this.props.fallback}
        </p>
      )
    }
    return this.props.children
  }
}
