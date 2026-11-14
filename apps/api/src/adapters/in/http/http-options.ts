import type { RateLimitStore } from '#app/ports/rate-limit-store.ts'

/**
 * Configuração do adapter HTTP, derivada do env e do perfil de plataforma em
 * `composition-root.ts`. O adapter não lê `process.env` nem conhece `config/`: recebe só o que
 * precisa, já validado.
 */
export interface HttpOptions {
  /**
   * Proxies confiáveis para `X-Forwarded-*`, por plataforma: 1 salto na Vercel; a rede do Caddy
   * (`172.30.0.0/24`) no CI e local; o valor medido no ensaio no Render.
   */
  readonly trustProxy: boolean | number | readonly string[]
  /**
   * Header com o request id gerado por quem está na frente (`x-vercel-id` na Vercel,
   * `x-request-id` do Caddy no CI e local); `null` = sempre um UUID próprio.
   */
  readonly requestIdHeader: string | null
  /**
   * `under-pressure` com limite de atraso do event loop (`MAX_EVENT_LOOP_DELAY_MS`). Desligado na
   * Vercel, onde o congelamento da instância entre invocações conta como atraso.
   */
  readonly eventLoopDelayGuard: boolean
  /** Swagger + Scalar em `/api/docs` (nunca em produção). */
  readonly docs: boolean
  /** Origem exata do ambiente (`WEB_ORIGIN`): a única aceita nas mutações e no stream. */
  readonly webOrigin: string
  /** Rotas `/api/v1/_eval/*` (só com `APP_ENV=ci`; o `buildApp` recusa fora do CI). */
  readonly evalRoutes: boolean
  /**
   * Export estático do web servido na mesma origem (só no Plano B, Render; ADR 0029). Ausente = a
   * plataforma serve o estático (CDN da Vercel) ou não há web (CI, dev com `next dev`).
   */
  readonly staticSite?: { readonly root: string }
  /**
   * Rate limit de aplicação com store compartilhado (Postgres). Ausente = não registrado (sem
   * banco): memória local não limita nada com várias instâncias.
   */
  readonly rateLimit?: RateLimitOptions
}

export interface RateLimitOptions {
  readonly store: RateLimitStore
  /** Padrão por rota; cada rota pode sobrescrever em `config.rateLimit`. */
  readonly max: number
  /** Janela fixa (o plano usa 60 s). */
  readonly timeWindowMs: number
}

/** Mesmo limite do Caddy da stack de CI e do proxy local (`request_body max_size 32KB`). */
export const BODY_LIMIT_BYTES = 32 * 1024

/** `under-pressure`: acima de 1 s de atraso no event loop, o processo recusa trabalho (503). */
export const MAX_EVENT_LOOP_DELAY_MS = 1000
