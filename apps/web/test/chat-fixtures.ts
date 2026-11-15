import type {
  Answer,
  AnswerMeta,
  Citation,
  QuestionDetail,
  ResolvedReferenceDate,
} from '@teko/shared/contracts'

/**
 * Dados de teste do chat no formato dos contratos: a pergunta do DoD (RCTE, art. 76, § 6º) em
 * 05/2008, com as redações reais da fixture da API.
 */

export const QUESTION_ID = '0193a3b0-7c1e-7b3a-9f00-4c2d1e5f6a7b'
export const CONVERSATION_ID = '0193a3b0-7c1e-7b3a-9f00-4c2d1e5f6a7c'

export function citation(id: string, overrides: Partial<Citation> = {}): Citation {
  return {
    id,
    stableKey: 'go:rcte:art:76:par:6',
    label: 'RCTE, art. 76, § 6º',
    family: 'rcte',
    jurisdiction: 'GO',
    document: {
      title: 'Regulamento do Código Tributário do Estado de Goiás',
      versionLabel: 'RCTE consolidado até o Decreto nº 10.986',
      sourceUrl: 'https://appasp.economia.go.gov.br/Legislacao/arquivos/Rcte/RCTE.htm',
    },
    validity: { from: '2004-11-04', to: '2009-11-23' },
    isCurrent: false,
    excerpt:
      '§ 6º Observado o disposto no § 5º, quando o contribuinte aplicar nos Programas GOYAZES',
    valid: true,
    ...overrides,
  }
}

export const RESOLVED_2008: ResolvedReferenceDate = {
  value: '2008-05-01',
  source: 'periodo_apuracao',
  periodBoundaryInside: false,
  alternatives: [],
}

export const META: AnswerMeta = {
  corpusVersion: 11,
  retrievalMode: 'hybrid',
  uncoveredFamilies: [],
  provider: 'fake',
  fallbackFrom: null,
  cached: false,
}

export const ANSWER: Answer = {
  markdown: 'Conforme as fontes [S1](cite:S1) e [S2](cite:S2), a regra vigente na data é a citada.',
  citations: [
    citation('S1'),
    citation('S2', {
      stableKey: 'go:rcte:art:76:par:5',
      label: 'RCTE, art. 76, § 5º',
      validity: { from: '2003-09-12', to: null },
      isCurrent: true,
    }),
  ],
  meta: META,
}

export function questionDetail(overrides: Partial<QuestionDetail> = {}): QuestionDetail {
  return {
    id: QUESTION_ID,
    conversationId: CONVERSATION_ID,
    question: 'O que diz o art. 76, § 6º do RCTE?',
    locale: 'pt-BR',
    families: [],
    referenceDate: '2008-05-01',
    referenceSource: 'periodo_apuracao',
    status: 'answered',
    answer: ANSWER,
    refusal: null,
    createdAt: '2026-11-15T12:00:00.000-03:00',
    ...overrides,
  }
}
