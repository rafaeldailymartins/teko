/**
 * Contador de janela fixa compartilhado entre instâncias, usado pelo `@fastify/rate-limit`.
 *
 * Memória local não serve: a Fluid compute da Vercel escala para várias instâncias. A
 * implementação real é o `PgRateLimitStore` (tabela `app.rate_limits`,
 * `INSERT … ON CONFLICT DO UPDATE … RETURNING count`), que chega com o schema; até lá a API não
 * registra rate limit de aplicação (o WAF da Vercel cobre o stream).
 */
export interface RateLimitHit {
  /** Requisições contadas na janela atual, incluindo esta. */
  readonly count: number
  /** Quanto falta para a janela atual acabar, em ms. */
  readonly resetInMs: number
}

export interface RateLimitStore {
  /** Incrementa o contador de `key` na janela fixa de `windowMs` e devolve o estado. */
  hit(key: string, windowMs: number): Promise<RateLimitHit>
}
