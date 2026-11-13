import { describe, expect, it } from 'vitest'
import {
  type AnswerMeta,
  type AskQuestionResponse,
  askQuestionRequestSchema,
  askQuestionResponseSchema,
  type Citation,
  citationSchema,
  coverageResponseSchema,
  createStreamErrorChunk,
  encodeSseChunk,
  feedbackRequestSchema,
  healthResponseSchema,
  onboardingRequestSchema,
  parseStreamError,
  QUESTION_MAX_LENGTH,
  questionIdParamsSchema,
  type ResolvedReferenceDate,
  SSE_DONE,
  SSE_HEARTBEAT,
  stableKeySchema,
  type TekoStreamChunk,
  tekoDataPartSchemas,
  tekoStreamChunkSchema,
  UI_MESSAGE_STREAM_HEADERS,
} from './index.ts'

const QUESTION_ID = '0192f1c4-7a2b-7c3d-8e4f-5a6b7c8d9e0f'
const CONVERSATION_ID = '0192f1c4-7a2b-7c3d-8e4f-000000000001'

const resolved: ResolvedReferenceDate = {
  value: '2024-03-01',
  source: 'periodo_apuracao',
  periodBoundaryInside: false,
  alternatives: [],
}

const citation: Citation = {
  id: 'S1',
  stableKey: 'go:rcte:art:76:par:6:inc:II',
  label: 'RCTE, art. 76, § 6º, II',
  family: 'rcte',
  jurisdiction: 'GO',
  document: {
    title: 'Regulamento do Código Tributário do Estado de Goiás',
    versionLabel: 'Consolidado até o Decreto nº 10.000',
    sourceUrl: 'https://appasp.economia.go.gov.br/legislacao/arquivos/Rcte/RCTE.htm',
  },
  validity: { from: '2006-05-01', to: '2010-01-01' },
  isCurrent: false,
  valid: true,
}

const meta: AnswerMeta = {
  corpusVersion: 12,
  retrievalMode: 'hybrid',
  uncoveredFamilies: [],
  provider: 'gemini',
  fallbackFrom: null,
  cached: false,
}

describe('health', () => {
  it('aceita o payload do /healthz', () => {
    expect(
      healthResponseSchema.parse({ status: 'ok', version: '0.1.0', gitSha: 'a1b2c3d', env: 'ci' }),
    ).toEqual({ status: 'ok', version: '0.1.0', gitSha: 'a1b2c3d', env: 'ci' })
    expect(
      healthResponseSchema.safeParse({
        status: 'draining',
        version: '0.1.0',
        gitSha: 'unknown',
        env: 'production',
      }).success,
    ).toBe(true)
  })

  it('rejeita SHA, status e env inválidos', () => {
    const base = { status: 'ok', version: '0.1.0', gitSha: 'a1b2c3d', env: 'ci' }
    expect(healthResponseSchema.safeParse({ ...base, gitSha: 'XYZ' }).success).toBe(false)
    expect(healthResponseSchema.safeParse({ ...base, status: 'down' }).success).toBe(false)
    expect(healthResponseSchema.safeParse({ ...base, env: 'local' }).success).toBe(false)
  })
})

describe('POST /api/v1/questions (requisição)', () => {
  const base = {
    conversationId: CONVERSATION_ID,
    question: '  Qual a redação do art. 76, § 6º do RCTE?  ',
    locale: 'pt-BR',
    source: 'default',
  }

  it('aceita PA ou data exata e apara a pergunta', () => {
    const parsed = askQuestionRequestSchema.parse({ ...base, periodoApuracao: '2006-05' })
    expect(parsed.question).toBe('Qual a redação do art. 76, § 6º do RCTE?')
    expect(
      askQuestionRequestSchema.safeParse({
        ...base,
        referenceDate: '2006-05-15',
        source: 'explicit',
        families: ['rcte', 'efd-icms-ipi'],
      }).success,
    ).toBe(true)
  })

  it('exige exatamente uma forma de data', () => {
    expect(askQuestionRequestSchema.safeParse(base).success).toBe(false)
    const both = askQuestionRequestSchema.safeParse({
      ...base,
      periodoApuracao: '2006-05',
      referenceDate: '2006-05-15',
    })
    expect(both.success).toBe(false)
    expect(both.error?.issues[0]?.path).toEqual(['referenceDate'])
  })

  it('rejeita campos desconhecidos, pergunta vazia ou longa e datas inválidas', () => {
    const ok = { ...base, periodoApuracao: '2024-03' }
    expect(askQuestionRequestSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false)
    expect(askQuestionRequestSchema.safeParse({ ...ok, question: '   ' }).success).toBe(false)
    expect(
      askQuestionRequestSchema.safeParse({ ...ok, question: 'a'.repeat(QUESTION_MAX_LENGTH + 1) })
        .success,
    ).toBe(false)
    expect(askQuestionRequestSchema.safeParse({ ...ok, periodoApuracao: '03/2024' }).success).toBe(
      false,
    )
    expect(askQuestionRequestSchema.safeParse({ ...ok, locale: 'es' }).success).toBe(false)
    expect(askQuestionRequestSchema.safeParse({ ...ok, families: [] }).success).toBe(false)
    expect(askQuestionRequestSchema.safeParse({ ...ok, families: ['EFD ICMS'] }).success).toBe(
      false,
    )
    expect(askQuestionRequestSchema.safeParse({ ...ok, conversationId: 'abc' }).success).toBe(false)
  })
})

describe('POST /api/v1/questions (respostas)', () => {
  const responses: AskQuestionResponse[] = [
    {
      status: 'accepted',
      questionId: QUESTION_ID,
      resolved,
    },
    {
      status: 'answered',
      questionId: QUESTION_ID,
      resolved,
      answer: { markdown: 'Resposta [S1](cite:S1)', citations: [citation], meta },
    },
    {
      status: 'refused',
      questionId: QUESTION_ID,
      resolved: { ...resolved, value: '2031-01-01', source: 'explicit' },
      refusal: {
        reason: 'out_of_coverage',
        coverage: [
          {
            family: 'efd-icms-ipi',
            jurisdiction: 'BR',
            covered: [{ from: '2012-01-01', to: '2026-11-10' }],
            verifiedAt: '2026-11-09',
          },
        ],
      },
    },
    {
      status: 'needs_clarification',
      reason: 'explicit_conflict',
      candidates: ['2024-03-01', '2023-05-01'],
    },
  ]

  it.each(responses.map((response) => [response.status, response] as const))(
    'aceita a variante %s',
    (_status, response) => {
      expect(askQuestionResponseSchema.parse(response)).toEqual(response)
    },
  )

  it('rejeita variantes incompletas', () => {
    expect(askQuestionResponseSchema.safeParse({ status: 'accepted' }).success).toBe(false)
    expect(
      askQuestionResponseSchema.safeParse({
        status: 'needs_clarification',
        reason: 'ambiguous_text',
        candidates: ['2024-03-01'],
      }).success,
    ).toBe(false)
    expect(askQuestionResponseSchema.safeParse({ status: 'pending' }).success).toBe(false)
  })

  it('accepted não traz ticket nem URL de stream (mesma origem, ADR 0029)', () => {
    const accepted = askQuestionResponseSchema.parse({
      status: 'accepted',
      questionId: QUESTION_ID,
      resolved,
      stream: { url: 'https://x/y', ticket: 't', expiresAt: '2026-11-10T12:01:00Z' },
    })
    expect(accepted).not.toHaveProperty('stream')
  })

  it('valida parâmetros de rota', () => {
    expect(questionIdParamsSchema.safeParse({ id: QUESTION_ID }).success).toBe(true)
    expect(questionIdParamsSchema.safeParse({ id: '1' }).success).toBe(false)
  })
})

describe('citações e chaves estáveis', () => {
  it('aceita as chaves canônicas do plano', () => {
    expect(stableKeySchema.safeParse('go:rcte:art:76:par:6:inc:II').success).toBe(true)
    expect(stableKeySchema.safeParse('br:efd-icms-ipi:reg:C170:campo:07').success).toBe(true)
    expect(stableKeySchema.safeParse('sp:ricms:art:1').success).toBe(false)
    expect(stableKeySchema.safeParse('go rcte art 76').success).toBe(false)
  })

  it('valida a citação', () => {
    expect(citationSchema.parse(citation)).toEqual(citation)
    expect(citationSchema.safeParse({ ...citation, id: 'S0' }).success).toBe(false)
    expect(
      citationSchema.safeParse({
        ...citation,
        document: { ...citation.document, sourceUrl: 'javascript:alert(1)' },
      }).success,
    ).toBe(false)
  })
})

describe('feedback, onboarding e cobertura', () => {
  it('aceita polegar com motivo opcional e rejeita texto livre', () => {
    expect(
      feedbackRequestSchema.safeParse({ rating: 'down', reason: 'wrong_citation' }).success,
    ).toBe(true)
    expect(feedbackRequestSchema.safeParse({ rating: 'up' }).success).toBe(true)
    expect(feedbackRequestSchema.safeParse({ rating: 'down', comment: 'meu CPF...' }).success).toBe(
      false,
    )
  })

  it('exige 18+ e país em ISO 3166-1', () => {
    const body = { isAdult: true, termsVersion: '2026-11-01', countryOfResidence: 'BR' }
    expect(onboardingRequestSchema.safeParse(body).success).toBe(true)
    expect(onboardingRequestSchema.safeParse({ ...body, isAdult: false }).success).toBe(false)
    expect(onboardingRequestSchema.safeParse({ ...body, countryOfResidence: 'br' }).success).toBe(
      false,
    )
  })

  it('valida a resposta de cobertura', () => {
    expect(
      coverageResponseSchema.safeParse({
        corpusVersion: 3,
        families: [
          {
            family: 'efd-reinf',
            jurisdiction: 'BR',
            covered: [{ from: '2018-05-01', to: '2026-11-10' }],
            verifiedAt: '2026-11-09',
          },
        ],
      }).success,
    ).toBe(true)
    expect(coverageResponseSchema.safeParse({ corpusVersion: -1, families: [] }).success).toBe(
      false,
    )
  })
})

describe('UI Message Stream', () => {
  const sequence: TekoStreamChunk[] = [
    { type: 'start', messageId: QUESTION_ID },
    { type: 'data-reference-date', data: resolved },
    { type: 'data-meta', data: meta },
    { type: 'data-citation', id: 'S1', data: citation },
    { type: 'text-start', id: 't1' },
    { type: 'text-delta', id: 't1', delta: 'Até 31/12/2009, ' },
    { type: 'text-end', id: 't1' },
    { type: 'data-refusal', data: { reason: 'no_evidence' } },
    {
      type: 'finish',
      messageMetadata: {
        usage: { inputTokens: 1200, outputTokens: 300 },
        model: 'gemini-3.6-flash',
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      },
    },
  ]

  it('valida cada chunk da sequência canônica', () => {
    for (const chunk of sequence) {
      expect(tekoStreamChunkSchema.parse(chunk)).toEqual(chunk)
    }
  })

  it('exige que o id do data-citation seja o da citação', () => {
    expect(
      tekoStreamChunkSchema.safeParse({ type: 'data-citation', id: 'S2', data: citation }).success,
    ).toBe(false)
  })

  it('expõe os schemas de payload por nome de data part', () => {
    expect(Object.keys(tekoDataPartSchemas)).toEqual([
      'reference-date',
      'meta',
      'citation',
      'refusal',
    ])
    expect(tekoDataPartSchemas.citation.safeParse(citation).success).toBe(true)
  })

  it('serializa SSE', () => {
    expect(encodeSseChunk({ type: 'text-end', id: 't1' })).toBe(
      'data: {"type":"text-end","id":"t1"}\n\n',
    )
    expect(SSE_HEARTBEAT).toBe(': hb\n\n')
    expect(SSE_DONE).toBe('data: [DONE]\n\n')
    expect(UI_MESSAGE_STREAM_HEADERS['x-vercel-ai-ui-message-stream']).toBe('v1')
  })

  it('codifica {code, retryable} no errorText do chunk error', () => {
    const chunk = createStreamErrorChunk('upstream_unavailable')
    expect(chunk).toEqual({
      type: 'error',
      errorText: '{"code":"upstream_unavailable","retryable":true}',
    })
    expect(tekoStreamChunkSchema.safeParse(chunk).success).toBe(true)
    expect(createStreamErrorChunk('internal', false)).toEqual({
      type: 'error',
      errorText: '{"code":"internal","retryable":false}',
    })
  })

  it('lê o errorText de volta', () => {
    expect(parseStreamError('{"code":"stream_busy","retryable":true}')).toEqual({
      code: 'stream_busy',
      retryable: true,
    })
    expect(parseStreamError('{"code":"teapot","retryable":true}')).toBeNull()
    expect(parseStreamError('An error occurred.')).toBeNull()
  })
})
