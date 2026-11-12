import { crc32, deflateRawSync } from 'node:zlib'

/**
 * Monta um `.zip` em memória para os testes do leitor e do `ingest load` (só o que o leitor usa:
 * cabeçalhos locais, diretório central e fim do diretório; métodos 0 e 8).
 */

export interface ZipEntryInput {
  readonly name: string
  readonly data: Uint8Array | string
  readonly method?: 0 | 8
  /** Grava o nome como cp437 (sem a flag UTF-8). */
  readonly rawName?: Uint8Array
  readonly flags?: number
  /** Sobrescreve o tamanho descomprimido declarado (testes de bomba/corrupção). */
  readonly declaredSize?: number
}

function u16(value: number): Uint8Array {
  const out = new Uint8Array(2)
  new DataView(out.buffer).setUint16(0, value, true)
  return out
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value >>> 0, true)
  return out
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

export function buildZip(entries: readonly ZipEntryInput[]): Uint8Array {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const data = typeof entry.data === 'string' ? new TextEncoder().encode(entry.data) : entry.data
    const method = entry.method ?? 8
    const compressed = method === 8 ? new Uint8Array(deflateRawSync(data)) : data
    const name = entry.rawName ?? new TextEncoder().encode(entry.name)
    const flags = entry.flags ?? (entry.rawName === undefined ? 0x0800 : 0)
    const size = entry.declaredSize ?? data.byteLength
    const crc = crc32(data)
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(flags),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.byteLength),
      u32(size),
      u16(name.byteLength),
      u16(0),
      name,
      compressed,
    ])
    centrals.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(flags),
        u16(method),
        u16(0),
        u16(0),
        u32(crc),
        u32(compressed.byteLength),
        u32(size),
        u16(name.byteLength),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    )
    locals.push(local)
    offset += local.byteLength
  }
  const central = concat(centrals)
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.byteLength),
    u32(offset),
    u16(0),
  ])
  return concat([...locals, central, end])
}
