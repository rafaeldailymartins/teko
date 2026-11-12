import { inflateRawSync } from 'node:zlib'

/**
 * Leitor mínimo de `.zip` para os pacotes da EFD-REINF (sem dependência nova): lê o diretório
 * central, confere cada cabeçalho local e descomprime com `inflateRawSync` (método 8) ou copia
 * (método 0). Zips aninhados (`pasta/pacote.zip`) são abertos até `MAX_DEPTH` níveis, com os
 * membros sob o caminho do zip interno (`pasta/pacote.zip/R-1000.xsd`).
 *
 * Defesas para arquivo baixado da internet: sem ZIP64 nem criptografia, sem caminho absoluto ou
 * com `..`, teto de membros, de bytes descomprimidos por membro e no total, e tamanho conferido
 * contra o declarado (bomba de descompressão). Nomes sem a flag UTF-8 (bit 11) são lidos como
 * cp850, a página OEM dos compactadores do Windows em português.
 */

const MAX_ZIP_ENTRIES = 2000
const MAX_ENTRY_BYTES = 64 * 1024 * 1024
const MAX_TOTAL_BYTES = 256 * 1024 * 1024
const MAX_DEPTH = 2

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const EOCD_MIN = 22
const UTF8_FLAG = 0x0800
const ENCRYPTED_FLAG = 0x0001

export class ZipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipError'
  }
}

/**
 * Tabela cp850 (OEM do Windows em português) dos bytes 0x80–0xFF: nomes de arquivo sem a flag
 * UTF-8, como nos pacotes da EFD-REINF.
 */
const CP850_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒ' +
  'áíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐' +
  '└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀' +
  'ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u00ad±‗¾¶§÷¸°¨·¹³²■\u00a0'

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }
  let name = ''
  for (const byte of bytes) {
    name += byte < 0x80 ? String.fromCharCode(byte) : (CP850_HIGH[byte - 0x80] ?? '?')
  }
  return name
}

function findEndOfCentralDirectory(view: DataView): number {
  const lowest = Math.max(0, view.byteLength - EOCD_MIN - 0xffff)
  for (let offset = view.byteLength - EOCD_MIN; offset >= lowest; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      return offset
    }
  }
  throw new ZipError('fim do diretório central não encontrado (não é um zip)')
}

function safeName(name: string): string {
  const normalized = name.replaceAll('\\', '/')
  if (
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split('/').some((part) => part === '..')
  ) {
    throw new ZipError(`caminho inseguro no zip: ${name}`)
  }
  return normalized
}

interface Budget {
  total: number
}

function readEntries(
  bytes: Uint8Array,
  prefix: string,
  depth: number,
  budget: Budget,
  out: Map<string, Uint8Array>,
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = findEndOfCentralDirectory(view)
  const count = view.getUint16(eocd + 10, true)
  const centralSize = view.getUint32(eocd + 12, true)
  let offset = view.getUint32(eocd + 16, true)
  if (count === 0xffff || offset === 0xffffffff || centralSize === 0xffffffff) {
    throw new ZipError('ZIP64 não é suportado')
  }
  if (count > MAX_ZIP_ENTRIES) {
    throw new ZipError(`zip com ${String(count)} membros (teto ${String(MAX_ZIP_ENTRIES)})`)
  }
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new ZipError('diretório central corrompido')
    }
    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const size = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const name = decodeName(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
      (flags & UTF8_FLAG) !== 0,
    )
    offset += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) {
      continue
    }
    const path = safeName(name)
    if ((flags & ENCRYPTED_FLAG) !== 0) {
      throw new ZipError(`membro criptografado: ${path}`)
    }
    if (size > MAX_ENTRY_BYTES) {
      throw new ZipError(`membro grande demais: ${path}`)
    }
    budget.total += size
    if (budget.total > MAX_TOTAL_BYTES) {
      throw new ZipError('conteúdo descomprimido acima do teto')
    }
    if (
      localOffset + 30 > bytes.byteLength ||
      view.getUint32(localOffset, true) !== LOCAL_SIGNATURE
    ) {
      throw new ZipError(`cabeçalho local inválido: ${path}`)
    }
    const dataStart =
      localOffset +
      30 +
      view.getUint16(localOffset + 26, true) +
      view.getUint16(localOffset + 28, true)
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize)
    if (compressed.byteLength !== compressedSize) {
      throw new ZipError(`membro truncado: ${path}`)
    }
    let data: Uint8Array
    if (method === 0) {
      data = compressed
    } else if (method === 8) {
      data = new Uint8Array(inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES }))
    } else {
      throw new ZipError(`método de compressão ${String(method)} não suportado: ${path}`)
    }
    if (data.byteLength !== size) {
      throw new ZipError(`tamanho descomprimido diferente do declarado: ${path}`)
    }
    const fullPath = `${prefix}${path}`
    if (path.toLowerCase().endsWith('.zip') && depth < MAX_DEPTH) {
      readEntries(data, `${fullPath}/`, depth + 1, budget, out)
    } else {
      out.set(fullPath, new Uint8Array(data))
    }
  }
}

/** Membros do zip (e dos zips internos), por caminho, na ordem do diretório central. */
export function readZip(bytes: Uint8Array): ReadonlyMap<string, Uint8Array> {
  if (bytes.byteLength < EOCD_MIN) {
    throw new ZipError('arquivo pequeno demais para ser um zip')
  }
  const members = new Map<string, Uint8Array>()
  readEntries(bytes, '', 0, { total: 0 }, members)
  return members
}
