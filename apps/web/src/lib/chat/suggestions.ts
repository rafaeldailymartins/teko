import type { PeriodoApuracao } from '@teko/shared/vigencia'

/**
 * Sugestões do chat vazio, todas sobre o corpus real (fixture e produção) e cada uma num período em
 * que a fonte tem redação vigente. Nenhuma pergunta se repete, e são quatro, uma por família.
 *
 * - A de destaque é a do DoD: RCTE, art. 76, § 6º em 05/2008 (redação de 04.11.04, piso de 40.000
 *   no GOYAZES/PROESPORTE) contra 01/2010 (revogado pelo Decreto nº 7.028, a partir de 23.11.09).
 * - As outras cobrem as demais famílias do corpus: EFD ICMS/IPI (Guia Prático 3.1.9, 2025),
 *   EFD-Reinf (leiautes 2.1.2, desde 09/2023) e o Guia Prático da EFD de Goiás (versão 5.9, desde
 *   16/03/2026).
 */

/** Família do corpus de onde a sugestão vem (documenta a cobertura das sugestões). */
type SuggestionFamily = 'rcte' | 'efd-icms-ipi' | 'efd-reinf' | 'efd-go'

/** Chave do texto da pergunta em `chat.suggestions.questions`. */
type SuggestionQuestion = 'rcte76' | 'efdC170' | 'reinfR4020' | 'efdGoTable52'

interface Suggestion {
  readonly id: string
  readonly family: SuggestionFamily
  readonly question: SuggestionQuestion
  readonly period: PeriodoApuracao
}

/** A pergunta do DoD em dois períodos com redações diferentes (a primeira linha). */
interface DateComparisonSuggestion {
  readonly id: string
  readonly family: SuggestionFamily
  readonly question: SuggestionQuestion
  readonly periods: readonly [PeriodoApuracao, PeriodoApuracao]
}

export const DATE_COMPARISON_SUGGESTION: DateComparisonSuggestion = {
  id: 'rcte-76-6-revogacao',
  family: 'rcte',
  question: 'rcte76',
  periods: ['2008-05', '2010-01'],
}

export const SUGGESTIONS: readonly Suggestion[] = [
  { id: 'efd-c170', family: 'efd-icms-ipi', question: 'efdC170', period: '2025-06' },
  { id: 'reinf-r4020', family: 'efd-reinf', question: 'reinfR4020', period: '2024-03' },
  { id: 'efd-go-tabela-5-2', family: 'efd-go', question: 'efdGoTable52', period: '2026-04' },
]
