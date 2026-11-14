/**
 * Normalização da pergunta para a chave do cache exato: Unicode NFKC, minúsculas, espaços
 * colapsados e sem pontuação final. "Qual a alíquota?" e "qual  a alíquota" dão a mesma chave; a
 * chave completa também leva data, `corpus_version`, versão do prompt, família de modelo e idioma.
 */
export function normalizeQuestion(question: string): string {
  return withoutTrailingPunctuation(
    question.normalize('NFKC').toLowerCase().replaceAll(/\s+/g, ' ').trim(),
  )
}

/** Sinais e espaços que saem do fim da pergunta ("qual a alíquota ? !" → "qual a alíquota"). */
const TRAILING = new Set([' ', '?', '!', '.', ';', ':'])

/**
 * Corta do fim os sinais e espaços, num laço linear: a regex `[\s?!.;:]+$` equivalente tinha
 * backtracking super-linear (SonarQube S8786).
 */
function withoutTrailingPunctuation(text: string): string {
  let end = text.length
  while (end > 0 && TRAILING.has(text.charAt(end - 1))) {
    end -= 1
  }
  return text.slice(0, end)
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
    [...parts.families].sort((a, b) => a.localeCompare(b, 'en')).join(','),
  ].join('|')
}
