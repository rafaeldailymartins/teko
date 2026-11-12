import { isIP } from 'node:net'

/**
 * Política de endereços do `SafeFetcher` (SSRF): só endereços públicos e roteáveis. Bloqueia, em
 * IPv4 e IPv6, loopback, redes privadas, CGNAT, link-local (inclusive o metadata de nuvem
 * `169.254.169.254` e o `fd00:ec2::254` da AWS, que cai em ULA), multicast, reservados e de
 * documentação. Endereços IPv6 que embutem um IPv4 (mapeado `::ffff:a.b.c.d`, compatível
 * `::a.b.c.d`, NAT64 `64:ff9b::/96` e 6to4 `2002::/16`) valem pelo IPv4 embutido.
 */

interface Range {
  readonly base: bigint
  readonly prefix: number
}

function v4(text: string, prefix: number): Range {
  return { base: parseIpv4(text) ?? 0n, prefix }
}

function v6(text: string, prefix: number): Range {
  return { base: parseIpv6(text) ?? 0n, prefix }
}

const BLOCKED_V4: readonly Range[] = [
  v4('0.0.0.0', 8), // "esta rede"
  v4('10.0.0.0', 8),
  v4('100.64.0.0', 10), // CGNAT
  v4('127.0.0.0', 8),
  v4('169.254.0.0', 16), // link-local e metadata
  v4('172.16.0.0', 12),
  v4('192.0.0.0', 24), // atribuições do IETF
  v4('192.0.2.0', 24), // documentação
  v4('192.88.99.0', 24), // relay 6to4 (obsoleto)
  v4('192.168.0.0', 16),
  v4('198.18.0.0', 15), // benchmark
  v4('198.51.100.0', 24),
  v4('203.0.113.0', 24),
  v4('224.0.0.0', 4), // multicast
  v4('240.0.0.0', 4), // reservado e broadcast
]

const BLOCKED_V6: readonly Range[] = [
  v6('::', 128), // não especificado
  v6('::1', 128), // loopback
  v6('100::', 64), // descarte
  v6('2001:db8::', 32), // documentação
  v6('2001::', 23), // atribuições do IETF (Teredo, ORCHID, benchmark)
  v6('fc00::', 7), // ULA
  v6('fe80::', 10), // link-local
  v6('fec0::', 10), // site-local (obsoleto)
  v6('ff00::', 8), // multicast
]

const MAPPED_V4 = v6('::ffff:0:0', 96)
const COMPATIBLE_V4 = v6('::', 96)
const NAT64 = v6('64:ff9b::', 96)
const SIX_TO_FOUR = v6('2002::', 16)

function inRange(value: bigint, range: Range, bits: number): boolean {
  const shift = BigInt(bits - range.prefix)
  return value >> shift === range.base >> shift
}

/** IPv4 decimal pontuado (4 octetos) como inteiro; `null` se inválido. */
export function parseIpv4(text: string): bigint | null {
  const parts = text.split('.')
  if (parts.length !== 4) {
    return null
  }
  let value = 0n
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) {
      return null
    }
    value = (value << 8n) | BigInt(part)
  }
  return value
}

/** Endereço sem a zona IPv6 (`fe80::1%eth0` → `fe80::1`). */
function withoutZone(address: string): string {
  const zone = address.indexOf('%')
  return zone === -1 ? address : address.slice(0, zone)
}

/** IPv6 (com `::`, IPv4 final e zona `%…`) como inteiro de 128 bits; `null` se inválido. */
export function parseIpv6(input: string): bigint | null {
  let text = withoutZone(input).toLowerCase()
  const tailV4 = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text)
  let tail: bigint[] = []
  if (tailV4?.[1] !== undefined) {
    const embedded = parseIpv4(tailV4[1])
    if (embedded === null) {
      return null
    }
    tail = [embedded >> 16n, embedded & 0xffffn]
    text = `${text.slice(0, -tailV4[1].length)}0:0`
  }
  const halves = text.split('::')
  if (halves.length > 2) {
    return null
  }
  const head = halves[0] === '' ? [] : (halves[0] ?? '').split(':')
  const rest = halves.length === 2 && halves[1] !== '' ? (halves[1] ?? '').split(':') : []
  const missing = 8 - head.length - rest.length
  if ((halves.length === 2 && missing < 1) || (halves.length === 1 && missing !== 0)) {
    return null
  }
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest]
  let value = 0n
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) {
      return null
    }
    value = (value << 16n) | BigInt(Number.parseInt(group, 16))
  }
  if (tail.length === 2) {
    value = ((value >> 32n) << 32n) | ((tail[0] ?? 0n) << 16n) | (tail[1] ?? 0n)
  }
  return value
}

function isBlockedV4(value: bigint): boolean {
  return BLOCKED_V4.some((range) => inRange(value, range, 32))
}

/**
 * `true` se o endereço não pode ser alvo da ingestão (privado, reservado, link-local etc.) ou se
 * não for um IP válido.
 */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(withoutZone(address))
  if (family === 4) {
    const value = parseIpv4(address)
    return value === null || isBlockedV4(value)
  }
  if (family !== 6) {
    return true
  }
  const value = parseIpv6(address)
  if (value === null) {
    return true
  }
  for (const embedding of [MAPPED_V4, NAT64]) {
    if (inRange(value, embedding, 128)) {
      return isBlockedV4(value & 0xffffffffn)
    }
  }
  if (inRange(value, SIX_TO_FOUR, 128)) {
    return isBlockedV4((value >> 80n) & 0xffffffffn)
  }
  if (inRange(value, COMPATIBLE_V4, 128) && value > 1n) {
    return isBlockedV4(value & 0xffffffffn)
  }
  return BLOCKED_V6.some((range) => inRange(value, range, 128))
}
