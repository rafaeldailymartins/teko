/**
 * Embeddings de texto (BGE-M3, 1024 dimensões). Adapters: Workers AI (`@cf/baai/bge-m3`) e o fake
 * de fixture (`EMBEDDINGS_PROVIDER=fake`, proibido em staging e produção). O texto entra já
 * redigido: nunca sai PII para o provedor.
 */
export interface EmbeddingPort {
  /** Identificador gravado em `chunks.embedding_model` (ex.: `@cf/baai/bge-m3`). */
  readonly model: string
  readonly dimensions: number
  /** Um vetor por texto, na mesma ordem. Rejeita se o sinal abortar. */
  embed(texts: readonly string[], options?: { readonly signal?: AbortSignal }): Promise<number[][]>
}

export class EmbeddingUnavailableError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options)
    this.name = 'EmbeddingUnavailableError'
  }
}
