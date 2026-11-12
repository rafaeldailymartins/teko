import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { request as httpsRequest } from 'node:https'
import type { LookupFunction } from 'node:net'
import {
  BlockedRequestError,
  type SafeFetcher,
  type SafeFetchRequest,
  type SafeFetchResponse,
} from '#app/ports/safe-fetcher.ts'
import { isBlockedAddress } from './ip-policy.ts'

/**
 * `SafeFetcher` sobre `node:https` (Segurança, SSRF, no plano). Defesas, nesta ordem, a cada salto:
 *
 * 1. a URL precisa ser `https`, sem credenciais, na porta 443 e com host da allowlist (comparação
 *    exata, sem curingas: os hosts das fontes de `corpus/sources.yaml`);
 * 2. o DNS é resolvido antes e **de novo na conexão** (`lookup` do `https.request`), e qualquer
 *    endereço privado, link-local, de metadata ou reservado (IPv4, IPv6 e IPv4 embutido em IPv6)
 *    derruba a requisição: um DNS que muda entre a checagem e a conexão (rebinding) não passa;
 * 3. no máximo 1 requisição por segundo por host (os saltos de redirect contam);
 * 4. no máximo 3 redirects, cada destino revalidado do passo 1;
 * 5. teto de bytes (cabeçalho `content-length` e contagem do corpo) e timeout;
 * 6. até 2 novas tentativas (2 s e 4 s de espera) para erro de rede transitório (`ECONNRESET`,
 *    `ETIMEDOUT`, "socket hang up"…) e 502/503/504, dentro do mesmo timeout total; bloqueio de
 *    segurança e cancelamento nunca são repetidos. Um `ECONNRESET` do site da Sefaz-GO derrubava o
 *    `discover` inteiro (ingest de 2026-11-12).
 *
 * O User-Agent é fixo e não pode ser trocado pelo chamador. Sem `accept-encoding`: o corpo vem
 * como publicado, e o sha256 é o do arquivo.
 */

export const CORPUS_USER_AGENT = 'teko-corpus-watch (+github.com/rafaeldailymartins/teko)'
const DEFAULT_MAX_BYTES = 200 * 1024 * 1024
const MAX_REDIRECTS = 3
const MIN_INTERVAL_MS = 1000
const DEFAULT_TIMEOUT_MS = 300_000
/** Tentativas além da primeira para erro de rede transitório ou 502/503/504. */
const DEFAULT_RETRIES = 2
/** Espera antes da 1ª nova tentativa; dobra a cada uma (2 s, 4 s). */
const DEFAULT_RETRY_DELAY_MS = 2000

/** Códigos de erro de socket e DNS que costumam passar sozinhos. */
const TRANSIENT_ERROR_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EPIPE',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
])
/** Respostas de servidor ou gateway temporariamente indisponível. */
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([502, 503, 504])

/**
 * Erro de rede que vale tentar de novo: os códigos de `TRANSIENT_ERROR_CODES` (no erro ou na
 * causa) e o "socket hang up" do `node:https`. Bloqueio de segurança e cancelamento nunca são.
 */
export function isTransientNetworkError(error: unknown): boolean {
  if (error instanceof BlockedRequestError || !(error instanceof Error)) {
    return false
  }
  const codes = [error, error.cause].map((item) =>
    item instanceof Error && 'code' in item ? String(item.code) : '',
  )
  return (
    codes.some((code) => TRANSIENT_ERROR_CODES.has(code)) || /socket hang up/i.test(error.message)
  )
}

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])
/** Cabeçalhos que o chamador não define (identidade e conexão ficam com o adapter). */
const RESERVED_HEADERS: ReadonlySet<string> = new Set([
  'host',
  'user-agent',
  'accept-encoding',
  'connection',
  'content-length',
  'transfer-encoding',
  'cookie',
  'authorization',
])

export interface ResolvedAddress {
  readonly address: string
  readonly family: number
}

/** Resolve todos os endereços de um host (padrão: `dns.lookup` com `all: true`). */
export type Resolver = (hostname: string) => Promise<readonly ResolvedAddress[]>

export interface TransportRequest {
  readonly url: URL
  readonly method: 'GET' | 'HEAD'
  readonly headers: Readonly<Record<string, string>>
  readonly maxBytes: number
  readonly signal: AbortSignal
  /** `lookup` validado, usado na conexão (o transporte real precisa repassá-lo ao socket). */
  readonly lookup: LookupFunction
}

export interface TransportResponse {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: Uint8Array
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>

export interface SafeFetcherOptions {
  /** Hosts permitidos (nome exato, minúsculo). */
  readonly allowedHosts: readonly string[]
  readonly resolver?: Resolver
  readonly transport?: Transport
  readonly now?: () => number
  readonly sleep?: (ms: number) => Promise<void>
  readonly minIntervalMs?: number
  readonly maxRedirects?: number
  readonly defaultMaxBytes?: number
  readonly timeoutMs?: number
  /** Novas tentativas para erro de rede transitório ou 502/503/504 (padrão: 2). */
  readonly retries?: number
  /** Espera antes da primeira nova tentativa, dobrada a cada uma (padrão: 2 s). */
  readonly retryDelayMs?: number
}

function defaultResolver(hostname: string): Promise<readonly ResolvedAddress[]> {
  return new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses: LookupAddress[]) => {
      if (error) {
        reject(error)
      } else {
        resolve(addresses)
      }
    })
  })
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Cabeçalhos de resposta com nome minúsculo; valores repetidos unidos por `, `. */
export function normalizeHeaders(
  raw: Readonly<Record<string, string | string[] | undefined>>,
): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw)) {
    if (value !== undefined) {
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value
    }
  }
  return headers
}

function tooLarge(url: URL, maxBytes: number): BlockedRequestError {
  return new BlockedRequestError(
    `resposta de ${url.host} passou do teto de ${String(maxBytes)} bytes`,
  )
}

/** Transporte real: `https.request` com o `lookup` validado e sem agente compartilhado. */
const httpsTransport: Transport = (request) =>
  new Promise((resolve, reject) => {
    const outgoing = httpsRequest(
      request.url,
      {
        method: request.method,
        headers: request.headers,
        lookup: request.lookup,
        signal: request.signal,
        agent: false,
      },
      (incoming) => {
        const status = incoming.statusCode ?? 0
        const headers = normalizeHeaders(incoming.headers)
        const declared = Number(headers['content-length'] ?? Number.NaN)
        if (declared > request.maxBytes) {
          incoming.destroy()
          reject(tooLarge(request.url, request.maxBytes))
          return
        }
        const chunks: Buffer[] = []
        let total = 0
        incoming.on('data', (chunk: Buffer) => {
          total += chunk.length
          if (total > request.maxBytes) {
            incoming.destroy(tooLarge(request.url, request.maxBytes))
            return
          }
          chunks.push(chunk)
        })
        incoming.on('error', reject)
        incoming.on('end', () => {
          resolve({ status, headers, body: new Uint8Array(Buffer.concat(chunks)) })
        })
      },
    )
    outgoing.on('error', reject)
    outgoing.end()
  })

/**
 * `lookup` de socket que só devolve endereços permitidos: resolve tudo e falha se algum endereço
 * do host for bloqueado (um host com um A público e outro privado é recusado por inteiro).
 */
export function createSafeLookup(resolver: Resolver): LookupFunction {
  return (hostname, options, callback) => {
    resolver(hostname).then(
      (addresses) => {
        const blocked = addresses.find((entry) => isBlockedAddress(entry.address))
        const first = addresses[0]
        if (blocked !== undefined || first === undefined) {
          const error = new BlockedRequestError(
            `${hostname} resolve para endereço bloqueado ou para nenhum endereço`,
          )
          callback(Object.assign(error, { code: 'EBLOCKED' }), '', 0)
          return
        }
        if (options.all === true) {
          callback(
            null,
            addresses.map((entry) => ({ address: entry.address, family: entry.family })),
          )
        } else {
          callback(null, first.address, first.family)
        }
      },
      (error: unknown) => {
        const failure = error instanceof Error ? error : new Error(String(error))
        callback(Object.assign(failure, { code: 'ENOTFOUND' }), '', 0)
      },
    )
  }
}

export function createSafeFetcher(options: SafeFetcherOptions): SafeFetcher {
  const allowed = new Set(options.allowedHosts.map((host) => host.toLowerCase()))
  const resolver = options.resolver ?? defaultResolver
  const transport = options.transport ?? httpsTransport
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? defaultSleep
  const minInterval = options.minIntervalMs ?? MIN_INTERVAL_MS
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retries = options.retries ?? DEFAULT_RETRIES
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  const lookup = createSafeLookup(resolver)
  const nextSlot = new Map<string, number>()

  function checkUrl(raw: string): URL {
    if (!URL.canParse(raw)) {
      throw new BlockedRequestError('URL inválida')
    }
    const url = new URL(raw)
    if (url.protocol !== 'https:') {
      throw new BlockedRequestError(`só https é aceito (${url.protocol} em ${url.host})`)
    }
    if (url.username !== '' || url.password !== '') {
      throw new BlockedRequestError(`URL com credenciais recusada (${url.host})`)
    }
    if (url.port !== '' && url.port !== '443') {
      throw new BlockedRequestError(`porta ${url.port} recusada (${url.hostname})`)
    }
    if (!allowed.has(url.hostname.toLowerCase())) {
      throw new BlockedRequestError(`host fora da allowlist: ${url.hostname}`)
    }
    return url
  }

  async function checkDns(hostname: string): Promise<void> {
    const addresses = await resolver(hostname)
    if (addresses.length === 0) {
      throw new BlockedRequestError(`${hostname} não resolve para nenhum endereço`)
    }
    const blocked = addresses.find((entry) => isBlockedAddress(entry.address))
    if (blocked !== undefined) {
      throw new BlockedRequestError(
        `${hostname} resolve para endereço bloqueado (${blocked.address})`,
      )
    }
  }

  /** Reserva o próximo horário livre do host (≥ `minInterval` depois do anterior) e espera. */
  async function throttle(hostname: string): Promise<void> {
    const current = now()
    const slot = Math.max(current, nextSlot.get(hostname) ?? 0)
    nextSlot.set(hostname, slot + minInterval)
    if (slot > current) {
      await sleep(slot - current)
    }
  }

  function requestHeaders(extra: Readonly<Record<string, string>> | undefined) {
    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(extra ?? {})) {
      const lower = name.toLowerCase()
      if (RESERVED_HEADERS.has(lower)) {
        throw new BlockedRequestError(`cabeçalho reservado ao adapter: ${lower}`)
      }
      headers[lower] = value
    }
    headers['user-agent'] = CORPUS_USER_AGENT
    headers['accept-encoding'] = 'identity'
    return headers
  }

  /**
   * Um salto (DNS, intervalo do host e transporte), com novas tentativas para erro de rede
   * transitório ou 502/503/504, espaçadas por `retryDelayMs` dobrado a cada uma. Tudo dentro do
   * mesmo `signal` (teto total e cancelamento): abortado, não tenta de novo.
   */
  async function hop(
    transportRequest: Omit<TransportRequest, 'lookup'>,
  ): Promise<TransportResponse> {
    for (let attempt = 0; ; attempt += 1) {
      const last = attempt >= retries
      try {
        await checkDns(transportRequest.url.hostname)
        await throttle(transportRequest.url.hostname)
        const response = await transport({ ...transportRequest, lookup })
        if (last || !TRANSIENT_STATUSES.has(response.status)) {
          return response
        }
      } catch (error) {
        if (last || transportRequest.signal.aborted || !isTransientNetworkError(error)) {
          throw error
        }
      }
      await sleep(retryDelayMs * 2 ** attempt)
    }
  }

  return {
    async fetch(request: SafeFetchRequest): Promise<SafeFetchResponse> {
      const method = request.method ?? 'GET'
      const maxBytes = request.maxBytes ?? options.defaultMaxBytes ?? DEFAULT_MAX_BYTES
      const headers = requestHeaders(request.headers)
      const timeout = AbortSignal.timeout(timeoutMs)
      const signal =
        request.signal === undefined ? timeout : AbortSignal.any([request.signal, timeout])
      let url = checkUrl(request.url)
      for (let redirects = 0; ; redirects += 1) {
        const response = await hop({ url, method, headers, maxBytes, signal })
        if (response.body.byteLength > maxBytes) {
          throw tooLarge(url, maxBytes)
        }
        const { location } = response.headers
        if (!REDIRECT_STATUSES.has(response.status) || location === undefined) {
          return {
            status: response.status,
            url: url.toString(),
            headers: response.headers,
            body: response.body,
          }
        }
        if (redirects >= maxRedirects) {
          throw new BlockedRequestError(
            `mais de ${String(maxRedirects)} redirects a partir de ${request.url}`,
          )
        }
        url = checkUrl(new URL(location, url).toString())
      }
    },
  }
}
