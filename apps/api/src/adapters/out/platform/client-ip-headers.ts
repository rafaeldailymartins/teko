import { isIP } from 'node:net'
import {
  type ClientIpInput,
  type ClientIpResult,
  ClientIpSource,
  type RequestHeaders,
} from '#app/ports/client-ip.ts'

/** Header que a Netlify injeta no proxy `signed` com o IP de quem chamou o site. */
export const NETLIFY_CLIENT_IP_HEADER = 'x-nf-client-connection-ip'

export const NO_CLIENT_IP: ClientIpResult = { ip: null, source: ClientIpSource.None }

/**
 * Valor único de um header, já validado como IP literal (v4 ou v6). Header repetido é ambíguo e
 * vale como ausente: nada arbitrário vai para chave de rate limit, log ou geo.
 */
export function singleIpHeader(headers: RequestHeaders, name: string): string | null {
  const value = headers[name]
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return isIP(trimmed) === 0 ? null : trimmed
}

/**
 * Regra do caminho proxiado, igual em todas as plataformas: `x-nf-client-connection-ip` só com
 * assinatura válida e só se a Netlify comprovadamente sobrescreve o valor do cliente (spike F1
 * (c), refletido em `trustNetlifyClientIp`). Caso contrário, nenhum IP: a chave vira a sessão.
 */
export function proxiedClientIp(
  input: ClientIpInput,
  trustNetlifyClientIp: boolean,
): ClientIpResult {
  if (!(trustNetlifyClientIp && input.signatureValid)) {
    return NO_CLIENT_IP
  }
  const ip = singleIpHeader(input.headers, NETLIFY_CLIENT_IP_HEADER)
  return ip === null ? NO_CLIENT_IP : { ip, source: ClientIpSource.NetlifyProxy }
}
