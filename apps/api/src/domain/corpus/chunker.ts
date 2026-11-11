import { normalizeForHash } from './text-normalization.ts'

/**
 * Divide o texto de uma redação em chunks. Em geral uma redação vira um chunk; o que passar do teto
 * (≈ 1.200 tokens, medidos como 4 caracteres por token) vira chunks com `ordinal` crescente,
 * cortados em fim de parágrafo, depois de frase, depois de palavra. Os chunks de continuação
 * repetem o rótulo do dispositivo no início, para a citação continuar legível isoladamente.
 *
 * Invariante (testada por propriedade): a concatenação dos corpos, sem o prefixo de continuação,
 * reproduz o texto normalizado.
 */

export const DEFAULT_MAX_CHUNK_CHARS = 4800

export interface ChunkPiece {
  readonly ordinal: number
  /** Texto do chunk (com o prefixo de continuação a partir do segundo). */
  readonly content: string
  /** Só o trecho do texto original, sem prefixo. */
  readonly body: string
}

/**
 * Texto que vai para o modelo de embedding: o caminho de títulos do dispositivo e o conteúdo do
 * chunk (contextual chunk embedding). Um campo curto do Guia ("06 COD_SIT Código da situação...")
 * só é reconhecível como "campo do C100" com o contexto; sem ele, o registro-pai, longo, vencia o
 * braço semântico nas perguntas sobre o campo (retrieval evals da F2, ADR 0010). O conteúdo
 * gravado e citado continua só o do chunk.
 */
export function embeddingText(headingPath: string, content: string): string {
  return `${headingPath}\n\n${content}`
}

export function continuationPrefix(label: string): string {
  return `${label} (continuação): `
}

/** Último ponto de corte aceitável em `text[0, limit]`, ou `limit` se não houver nenhum. */
function cutPoint(text: string, limit: number): number {
  const window = text.slice(0, limit)
  const minimum = Math.floor(limit / 2)
  for (const separator of ['\n\n', '. ', '; ', ' ']) {
    const index = window.lastIndexOf(separator)
    if (index >= minimum) {
      return index + separator.length
    }
  }
  return limit
}

/** Normaliza preservando quebras de parágrafo (que servem de ponto de corte preferido). */
function normalizeKeepingParagraphs(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map(normalizeForHash)
    .filter((paragraph) => paragraph.length > 0)
    .join('\n\n')
}

export function chunkText(
  text: string,
  label: string,
  maxChars: number = DEFAULT_MAX_CHUNK_CHARS,
): ChunkPiece[] {
  if (!Number.isInteger(maxChars) || maxChars < 200) {
    throw new RangeError(`maxChars precisa ser um inteiro >= 200: ${String(maxChars)}`)
  }
  const normalized = normalizeKeepingParagraphs(text)
  if (normalized.length === 0) {
    throw new RangeError('texto vazio não vira chunk')
  }
  const prefix = continuationPrefix(label)
  const pieces: ChunkPiece[] = []
  let rest = normalized
  while (rest.length > 0) {
    const room = pieces.length === 0 ? maxChars : Math.max(200, maxChars - prefix.length)
    const end = rest.length <= room ? rest.length : cutPoint(rest, room)
    const body = rest.slice(0, end)
    pieces.push(
      Object.freeze({
        ordinal: pieces.length,
        content: pieces.length === 0 ? body.trim() : `${prefix}${body.trim()}`,
        body,
      }),
    )
    rest = rest.slice(end)
  }
  return pieces
}
