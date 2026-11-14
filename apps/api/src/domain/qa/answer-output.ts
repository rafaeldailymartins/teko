/**
 * Regras sobre o texto que o LLM devolve (puras):
 *
 * - a sentinela `INSUFICIENTE` (resposta inteira) vira recusa `model_insufficient`;
 * - cada afirmação cita uma fonte com `[S1]`; o validador separa as citações válidas (fontes que
 *   existem no prompt) das inexistentes, que saem do texto; sem nenhuma válida, a resposta é
 *   recusada como `citation_invalid`;
 * - a saída final não leva HTML cru nem imagens (o markdown é renderizado no navegador);
 * - o canário do system prompt nunca pode aparecer na saída: se aparecer, a resposta é bloqueada.
 *
 * As regex usam classes negadas e nenhum quantificador aninhado: tempo linear no tamanho do texto.
 */
export const INSUFFICIENT_SENTINEL = 'INSUFICIENTE'

const CITATION_MARKER = /\[(S[1-9]\d{0,2})\]/g
const LINKABLE_CITATION = /(?<!!)\[(S[1-9]\d{0,2})\]/g

export function isInsufficient(text: string): boolean {
  return text.trim().replace(/[.!]$/, '').toUpperCase() === INSUFFICIENT_SENTINEL
}

/** Ids citados, na ordem da primeira citação, sem repetição. */
export function citedIds(text: string): string[] {
  return [...new Set([...text.matchAll(CITATION_MARKER)].map((match) => match[1] as string))]
}

export interface CitationCheck {
  /** Citadas e presentes no prompt, na ordem da primeira citação. */
  readonly valid: readonly string[]
  /** Citadas, mas inexistentes no prompt (removidas do texto). */
  readonly unknown: readonly string[]
  /** Texto sem os marcadores inexistentes. */
  readonly text: string
}

export function checkCitations(text: string, available: readonly string[]): CitationCheck {
  const known = new Set(available)
  const cited = citedIds(text)
  const unknown = cited.filter((id) => !known.has(id))
  const missing = new Set(unknown)
  const cleaned = text.replaceAll(CITATION_MARKER, (marker, id: string) =>
    missing.has(id) ? '' : marker,
  )
  return { valid: cited.filter((id) => known.has(id)), unknown, text: cleaned }
}

/**
 * `[S1]` → `[S1](cite:S1)`: o link que a web troca pelo chip da citação. Depois de `!`, o marcador
 * fica como está: `![S1](cite:S1)` seria uma imagem.
 */
export function toCitationLinks(text: string): string {
  return text.replaceAll(LINKABLE_CITATION, (_marker, id: string) => `[${id}](cite:${id})`)
}

const HTML_TAG = /<\/?[A-Za-z!][^<>]*>/g
const IMAGE = /!\[[^\]\n]*\]\([^)\n]*\)/g

/**
 * Remove HTML cru e imagens em markdown, repetindo até o texto parar de mudar: tirar `<b>` de
 * `<a<b>>` forma `<a>`. Cada passada remove ao menos um caractere, então o laço termina.
 */
export function sanitizeAnswerMarkdown(text: string): string {
  let current = text
  let previous: string
  do {
    previous = current
    current = current.replaceAll(IMAGE, '').replaceAll(HTML_TAG, '')
  } while (current !== previous)
  return current
}

/**
 * Texto final de uma resposta: sem HTML nem imagens e com as citações como links `cite:`. Saneia de
 * novo depois dos links, porque um link pode completar uma imagem (`![[S1]` → `![[S1](cite:S1)`).
 */
export function renderAnswerMarkdown(text: string): string {
  return sanitizeAnswerMarkdown(toCitationLinks(sanitizeAnswerMarkdown(text)))
}

export function leaksCanary(text: string, canary: string): boolean {
  return text.includes(canary)
}
