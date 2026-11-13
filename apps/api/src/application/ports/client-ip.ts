/**
 * IP do cliente conforme a plataforma (Pipeline HTTP do plano). A web e a API estão na mesma
 * origem (ADR 0029): toda requisição chega direto do navegador à borda da plataforma, sem proxy de
 * terceiros no meio.
 *
 * - Vercel: `x-real-ip`, que a borda sobrescreve e nunca repassa do cliente;
 * - fora dela (CI, local, Render): o IP que o servidor HTTP calculou com o `trustProxy` da
 *   plataforma.
 *
 * O resultado serve para rate limit, log e geo; nunca para autorização.
 */
export const ClientIpSource = {
  /** Header da borda da plataforma (`x-real-ip` na Vercel). */
  Platform: 'platform',
  /** Socket + `X-Forwarded-For` filtrado pelo `trustProxy` (CI, local, Render). */
  TrustedProxy: 'trusted_proxy',
  /** Nenhuma fonte confiável. */
  None: 'none',
} as const
export type ClientIpSource = (typeof ClientIpSource)[keyof typeof ClientIpSource]

export type RequestHeaders = Readonly<Record<string, string | readonly string[] | undefined>>

export interface ClientIpInput {
  readonly headers: RequestHeaders
  /** IP calculado pelo servidor HTTP a partir do socket e do `trustProxy`. */
  readonly forwardedIp: string
}

export interface ClientIpResult {
  readonly ip: string | null
  readonly source: ClientIpSource
}

export interface ClientIp {
  resolve(input: ClientIpInput): ClientIpResult
}
