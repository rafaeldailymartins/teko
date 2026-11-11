/**
 * Fonte de tempo da aplicação. Nada em `domain/` ou `application/` chama `Date.now()` direto:
 * os testes injetam um relógio fixo e a produção usa `adapters/out/clock`.
 */
export interface Clock {
  /** Instante atual. Cada chamada devolve um `Date` novo (o chamador pode mutá-lo). */
  now(): Date
}
