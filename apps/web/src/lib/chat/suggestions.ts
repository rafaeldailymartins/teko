import type { PeriodoApuracao } from '@teko/shared/vigencia'

/**
 * Sugestões do chat vazio, sensíveis à data: a mesma pergunta em dois períodos com redações
 * diferentes do RCTE, art. 76, § 6º (fixture e corpus reais):
 *
 * - 05/2008 (redação de 04.11.04, piso de 40.000 no GOYAZES/PROESPORTE) contra 01/2010 (revogado
 *   pelo Decreto nº 7.028, a partir de 23.11.09);
 * - 03/2004 (redação de 12.09.03, projeto de R$ 300.000,00) contra 05/2006 (redação de 04.11.04).
 */
export interface DateSensitiveSuggestion {
  readonly id: string
  /** Chave do texto da pergunta em `chat.suggestions.questions`. */
  readonly question: 'rcte76'
  readonly periods: readonly [PeriodoApuracao, PeriodoApuracao]
}

export const DATE_SENSITIVE_SUGGESTIONS: readonly DateSensitiveSuggestion[] = [
  { id: 'rcte-76-6-revogacao', question: 'rcte76', periods: ['2008-05', '2010-01'] },
  { id: 'rcte-76-6-redacoes', question: 'rcte76', periods: ['2004-03', '2006-05'] },
]
