import type { RateLimitStore } from '#app/ports/rate-limit-store.ts'

/**
 * Configuração do adapter HTTP, derivada do env e do perfil de plataforma em
 * `composition-root.ts`. O adapter não lê `process.env` nem conhece `config/`: recebe só o que
 * precisa, já validado.
 */
export interface HttpOptions {
  /** Origem exata da web (`https://tekoia.netlify.app`); única origem aceita pelo CORS do stream. */
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
  /**
   * `under-pressure` com limite de atraso do event loop (`MAX_EVENT_LOOP_DELAY_MS`). Desligado na
   * Vercel, onde o congelamento da instância entre invocações conta como atraso.
   */
  readonly eventLoopDelayGuard: boolean
  /** Swagger + Scalar em `/api/docs` (nunca em produção). */
  readonly docs: boolean
  /**
   * Rotas `/api/_spike/*` dos spikes da F1 (SSE, eco do proxy, runtime, `waitUntil`). Só existem
   * em staging na Vercel (`createHttpOptions`); ausente = não registradas.
   */
  readonly spike?: SpikeRouteOptions
  /**
   * Rate limit de aplicação com store compartilhado (Postgres). Ausente = não registrado: a F1 não
   * tem store nem rotas transacionais, e memória local não limita nada com várias instâncias.
   */
  readonly rateLimit?: RateLimitOptions
}

/** O que as rotas de spike expõem do runtime; nunca valores de segredo. */
export interface SpikeRouteOptions {
  /** `process.version` do processo. */
  readonly nodeVersion: string
  /** `VERCEL_REGION` em runtime (`null` fora da Vercel). */
  readonly region: string | null
  /** `FUNCTION_MAX_DURATION_S` configurado. */
  readonly maxDurationS: number
  /** Tamanho da Sensitive de teste (`null` = ausente); o valor nunca sai do processo. */
  readonly sensitiveLength: number | null
  /** Segredo do proxy assinado da Netlify; ausente = o eco não verifica a assinatura. */
  readonly proxySecret?: string
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
