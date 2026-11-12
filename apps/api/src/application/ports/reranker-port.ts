/**
 * Reranker: nota de relevância de cada texto para a pergunta, comparando os dois diretamente (ADR
 * 0027). Adapter: Workers AI (`@cf/baai/bge-reranker-base`). O texto entra já redigido: nunca sai
 * PII para o provedor.
 */
export interface RerankerPort {
  /** Identificador do modelo (ex.: `@cf/baai/bge-reranker-base`). */
  readonly model: string
  /** Uma nota por texto, na mesma ordem (maior = mais relevante). Rejeita se o sinal abortar. */
  rerank(
    query: string,
    texts: readonly string[],
    options?: { readonly signal?: AbortSignal },
  ): Promise<number[]>
}

export class RerankerUnavailableError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options)
    this.name = 'RerankerUnavailableError'
  }
}
