/**
 * Forma canônica de um texto para o `content_hash`: NFC, sem caracteres de largura zero e de
 * controle, com espaços colapsados e aparados. Assim o hash não muda com diferenças só de
 * whitespace ou de codificação entre downloads da mesma fonte, e versões consecutivas com o mesmo
 * texto viram uma única redação. O hash em si (sha256) fica no adapter `crypto`, porque o domínio
 * não depende do Node.
 */

function codePointRange(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, offset) => first + offset)
}

/**
 * Largura zero (ZWSP, ZWNJ, ZWJ, WJ, BOM) e controles C0/C1, exceto os de espaço (tab, LF, FF, CR),
 * que o colapso de whitespace trata. Por código, e não por regex, porque caractere de controle em
 * regex é proibido pelo lint (`noControlCharactersInRegex`).
 */
const INVISIBLE: ReadonlySet<number> = new Set([
  0x200b,
  0x200c,
  0x200d,
  0x2060,
  0xfeff,
  ...codePointRange(0x00, 0x08),
  0x0b,
  ...codePointRange(0x0e, 0x1f),
  ...codePointRange(0x7f, 0x9f),
])
const WHITESPACE = /\s+/g

function stripInvisible(text: string): string {
  return Array.from(text)
    .filter((char) => !INVISIBLE.has(char.codePointAt(0) as number))
    .join('')
}

export function normalizeForHash(text: string): string {
  // Os invisíveis saem antes do NFC: um ZWSP entre a letra e o acento impediria a composição, e
  // a forma normalizada deixaria de ser idempotente.
  return stripInvisible(text).normalize('NFC').replace(WHITESPACE, ' ').trim()
}
