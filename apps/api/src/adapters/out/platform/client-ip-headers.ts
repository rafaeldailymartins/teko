import { isIP } from 'node:net'
import { type ClientIpResult, ClientIpSource, type RequestHeaders } from '#app/ports/client-ip.ts'

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
