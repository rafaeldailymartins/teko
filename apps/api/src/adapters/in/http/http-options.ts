import type { RateLimitStore } from '#app/ports/rate-limit-store.ts'

/**
 * Configuração do adapter HTTP, derivada do env e do perfil de plataforma em
 * `composition-root.ts`. O adapter não lê `process.env` nem conhece `config/`: recebe só o que
 * precisa, já validado.
 */
export interface HttpOptions {
  /** Origem exata da web (`https://teko-web.netlify.app`); única origem aceita pelo CORS do stream. */
  readonly webOrigin: string
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
  /** Swagger + Scalar em `/api/docs` (nunca em produção). */
  readonly docs: boolean
  /**
   * Rate limit de aplicação com store compartilhado (Postgres). Ausente = não registrado: a F1 não
   * tem store nem rotas transacionais, e memória local não limita nada com várias instâncias.
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
