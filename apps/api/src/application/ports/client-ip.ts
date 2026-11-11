/**
 * IP do cliente conforme a plataforma e o caminho da requisição (Pipeline HTTP do plano).
 *
 * - **Direto** (navegador → API: `/healthz` e o stream): na Vercel, `x-real-ip`, que a borda
 *   sobrescreve; fora dela, o IP que o servidor HTTP calculou com o `trustProxy` da plataforma.
 * - **Proxiado** (navegador → Netlify → API): todo usuário chega pelos IPs de saída da Netlify,
 *   então o IP de rede não identifica ninguém. `x-nf-client-connection-ip` só vale com assinatura
 *   `x-nf-sign` válida **e** se o spike F1 (c) provar que a Netlify sobrescreve o valor enviado
 *   pelo cliente; senão o resultado é `null` e a chave de rate limit passa a ser a sessão.
 *
 * O resultado serve para rate limit, log e geo; nunca para autorização.
 */
export const ClientPath = {
  Direct: 'direct',
  Proxied: 'proxied',
} as const
export type ClientPath = (typeof ClientPath)[keyof typeof ClientPath]

export const ClientIpSource = {
  /** Header da borda da plataforma (`x-real-ip` na Vercel). */
  Platform: 'platform',
  /** `x-nf-client-connection-ip`, com assinatura válida e header comprovadamente sobrescrito. */
  NetlifyProxy: 'netlify_proxy',
  /** Socket + `X-Forwarded-For` filtrado pelo `trustProxy` (CI, local, Render). */
  TrustedProxy: 'trusted_proxy',
  /** Nenhuma fonte confiável. */
  None: 'none',
} as const
export type ClientIpSource = (typeof ClientIpSource)[keyof typeof ClientIpSource]

export type RequestHeaders = Readonly<Record<string, string | readonly string[] | undefined>>

export interface ClientIpInput {
  readonly path: ClientPath
  /** Assinatura `x-nf-sign` válida (só faz sentido no caminho proxiado). */
  readonly signatureValid: boolean
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
