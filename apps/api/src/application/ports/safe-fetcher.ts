/**
 * HTTP de saída da ingestão e do watch (`SafeFetcher`; Segurança, SSRF, no plano): só `https`, só
 * hosts da allowlist, DNS resolvido e IPs privados, link-local e de metadata bloqueados, no máximo
 * 3 redirects (cada um revalidado), no máximo 1 requisição por segundo por host e o User-Agent
 * `teko-corpus-watch (+github.com/rafaeldailymartins/teko)`. Roda só no Actions e localmente.
 */

export interface SafeFetchRequest {
  readonly url: string
  readonly method?: 'GET' | 'HEAD'
  /** Ex.: `if-none-match`, `if-modified-since` (GET condicional do watch). */
  readonly headers?: Readonly<Record<string, string>>
  readonly signal?: AbortSignal
  /** Teto do corpo, em bytes (padrão do adapter: 200 MB). */
  readonly maxBytes?: number
}

export interface SafeFetchResponse {
  readonly status: number
  /** URL final, depois dos redirects. */
  readonly url: string
  /** Cabeçalhos com nome em minúsculas. */
  readonly headers: Readonly<Record<string, string>>
  /** Corpo inteiro (vazio em 304 e em HEAD). */
  readonly body: Uint8Array
}

export interface SafeFetcher {
  fetch(request: SafeFetchRequest): Promise<SafeFetchResponse>
}

export class BlockedRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockedRequestError'
  }
}
