/**
 * Tradução da pergunta antes da busca (ADR 0034): o corpus, o braço léxico e o reranker são em
 * português, e uma pergunta em inglês ("income tax withheld") não casa com o texto ("Valor da
 * retencao do IR"). Adapter: Workers AI (`@cf/meta/m2m100-1.2b`). O texto entra já redigido: nunca
 * sai PII para o provedor.
 */
export interface TranslatorPort {
  /** Identificador do modelo (ex.: `@cf/meta/m2m100-1.2b`). */
  readonly model: string
  /** Texto traduzido do inglês para o português. Rejeita se o sinal abortar. */
  toPortuguese(text: string, options?: { readonly signal?: AbortSignal }): Promise<string>
}

export class TranslatorUnavailableError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options)
    this.name = 'TranslatorUnavailableError'
  }
}
