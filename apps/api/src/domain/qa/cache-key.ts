/**
 * Normalização da pergunta para a chave do cache exato: Unicode NFKC, minúsculas, espaços
 * colapsados e sem pontuação final. "Qual a alíquota?" e "qual  a alíquota" dão a mesma chave; a
 * chave completa também leva data, `corpus_version`, versão do prompt, família de modelo e idioma.
 */
export function normalizeQuestion(question: string): string {
  return question
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll(/\s+/g, ' ')
    .trim()
    .replace(/[\s?!.;:]+$/, '')
}

export interface CacheKeyParts {
  readonly question: string
  readonly referenceDate: string
  readonly corpusVersion: number
  readonly promptVersion: string
  /** `zdr` (Groq) ou `default` (cadeia completa): respostas de modelos diferentes não se misturam. */
  readonly modelFamily: 'zdr' | 'default'
  readonly locale: string
  readonly families: readonly string[]
}

/** Texto que vira sha256 na chave do cache. */
export function cacheKeyMaterial(parts: CacheKeyParts): string {
  return [
    normalizeQuestion(parts.question),
    parts.referenceDate,
    String(parts.corpusVersion),
    parts.promptVersion,
    parts.modelFamily,
    parts.locale,
    [...parts.families].sort().join(','),
  ].join('|')
}
