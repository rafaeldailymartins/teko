import type { Citation } from '@teko/shared/contracts'
import type { Locale } from '@teko/shared/i18n'
import type { IsoDate } from '@teko/shared/vigencia'
import { localePagePath } from '../navigation.ts'

/**
 * Citação aberta no painel: as citações da resposta a que ela pertence (para `[`/`]`), a posição
 * atual, a pergunta (para "reportar") e a data de referência usada (para o link do dispositivo).
 */
export interface CitationSelection {
  readonly citations: readonly Citation[]
  readonly index: number
  readonly questionId: string | null
  readonly referenceDate: IsoDate | null
}

export function selectedCitation(selection: CitationSelection | null): Citation | null {
  return selection?.citations[selection.index] ?? null
}

/** Anda `step` posições, sem dar a volta (para no primeiro e no último). */
export function stepSelection(selection: CitationSelection, step: number): CitationSelection {
  const last = selection.citations.length - 1
  const index = Math.min(Math.max(selection.index + step, 0), Math.max(last, 0))
  return index === selection.index ? selection : { ...selection, index }
}

/**
 * Página do dispositivo (linha do tempo e "O que mudou", do agente de histórico e dispositivos):
 * `/<locale>/provision/?k=<stableKey>&ref=<data>`.
 */
export function provisionHref(
  locale: Locale,
  stableKey: string,
  referenceDate: IsoDate | null,
): string {
  const query = new URLSearchParams({ k: stableKey })
  if (referenceDate !== null) query.set('ref', referenceDate)
  return `${localePagePath(locale, 'provision')}?${query.toString()}`
}

/**
 * Texto de "copiar citação": dispositivo, documento e versão, a linha de vigência (já traduzida
 * pela UI) e a fonte.
 */
export function citationReference(citation: Citation, validityLine: string): string {
  return [
    citation.label,
    `${citation.document.title} (${citation.document.versionLabel})`,
    validityLine,
    citation.document.sourceUrl,
  ].join('\n')
}
