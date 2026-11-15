import { describe, expect, it } from 'vitest'
import {
  ANSWER,
  citation,
  META,
  questionDetail,
  RESOLVED_2008,
} from '../../../test/chat-fixtures.ts'
import {
  answerParts,
  answerValidity,
  answerView,
  chatDataPartSchemas,
  clarificationParts,
  DegradationLabel,
  degradationLabels,
  messageText,
  partsToChunks,
  questionDetailMessages,
  refusalParts,
  type TekoUIMessage,
} from './parts.ts'

const assistant = (parts: TekoUIMessage['parts']): TekoUIMessage => ({
  id: 'm',
  role: 'assistant',
  parts,
})

describe('answerView (mapeamento dos data parts)', () => {
  it('lê data, meta, citações em ordem e o texto concatenado', () => {
    const view = answerView(
      assistant([
        { type: 'data-reference-date', data: RESOLVED_2008 },
        { type: 'data-meta', data: META },
        { type: 'data-citation', id: 'S2', data: citation('S2') },
        { type: 'data-citation', id: 'S10', data: citation('S10') },
        { type: 'data-citation', id: 'S1', data: citation('S1') },
        { type: 'text', text: 'Conforme ' },
        { type: 'text', text: '[S1](cite:S1).' },
      ]),
    )
    expect(view.reference).toEqual(RESOLVED_2008)
    expect(view.meta).toEqual(META)
    expect(view.citations.map((item) => item.id)).toEqual(['S1', 'S2', 'S10'])
    expect(view.text).toBe('Conforme [S1](cite:S1).')
    expect(view.refusal).toBeNull()
    expect(view.clarification).toBeNull()
  })

  it('a citação atualizada no fim do stream (valid: false) substitui a anterior', () => {
    const view = answerView(
      assistant([
        { type: 'data-citation', id: 'S1', data: citation('S1') },
        { type: 'data-citation', id: 'S1', data: citation('S1', { valid: false }) },
      ]),
    )
    expect(view.citations).toEqual([citation('S1', { valid: false })])
  })

  it('lê recusa e esclarecimento, e ignora partes que não são do Tekó', () => {
    const view = answerView(
      assistant([
        { type: 'step-start' },
        { type: 'data-refusal', data: { reason: 'no_evidence' } },
        {
          type: 'data-clarification',
          data: { reason: 'ambiguous_text', candidates: ['2004-03-01', '2006-05-01'] },
        },
      ]),
    )
    expect(view.refusal).toEqual({ reason: 'no_evidence' })
    expect(view.clarification?.candidates).toEqual(['2004-03-01', '2006-05-01'])
  })

  it('messageText junta só as partes de texto', () => {
    expect(messageText({ parts: [{ type: 'step-start' }, { type: 'text', text: 'oi' }] })).toBe(
      'oi',
    )
  })
})

describe('degradationLabels', () => {
  it('mapeia busca só lexical, fallback e cache', () => {
    expect(degradationLabels(null)).toEqual([])
    expect(degradationLabels(META)).toEqual([])
    expect(
      degradationLabels({
        ...META,
        retrievalMode: 'lexical_only',
        fallbackFrom: 'gemini-flash-lite',
        cached: true,
      }),
    ).toEqual([DegradationLabel.LexicalOnly, DegradationLabel.Fallback, DegradationLabel.Cached])
  })
})

describe('answerValidity', () => {
  it('é a interseção das vigências das citações válidas', () => {
    expect(answerValidity(ANSWER.citations)).toEqual({ from: '2004-11-04', to: '2009-11-23' })
  })

  it('ignora citação inválida e devolve null sem citações', () => {
    expect(answerValidity([])).toBeNull()
    expect(
      answerValidity([
        citation('S1', { validity: { from: '2009-11-23', to: null } }),
        citation('S2', { valid: false }),
      ]),
    ).toEqual({ from: '2009-11-23', to: null })
  })

  it('devolve null quando as vigências não se cruzam', () => {
    expect(
      answerValidity([
        citation('S1', { validity: { from: '2001-01-01', to: '2002-01-01' } }),
        citation('S2', { validity: { from: '2003-01-01', to: null } }),
      ]),
    ).toBeNull()
  })
})

describe('partes e chunks sintetizados', () => {
  it('answerParts põe a data, o meta, as citações e o texto', () => {
    const parts = answerParts(RESOLVED_2008, ANSWER)
    expect(parts.map((part) => part.type)).toEqual([
      'data-reference-date',
      'data-meta',
      'data-citation',
      'data-citation',
      'text',
    ])
    expect(answerView(assistant(parts)).text).toBe(ANSWER.markdown)
  })

  it('partsToChunks sem id não manda messageId e repete o texto em um delta', () => {
    const chunks = partsToChunks([
      ...refusalParts(RESOLVED_2008, { reason: 'no_evidence' }),
      { type: 'text', text: 'x' },
    ])
    expect(chunks).toEqual([
      { type: 'start' },
      { type: 'data-reference-date', data: RESOLVED_2008 },
      { type: 'data-refusal', data: { reason: 'no_evidence' } },
      { type: 'text-start', id: 'text-0' },
      { type: 'text-delta', id: 'text-0', delta: 'x' },
      { type: 'text-end', id: 'text-0' },
      { type: 'finish' },
    ])
  })

  it('clarificationParts valida contra o schema do data part', () => {
    const [part] = clarificationParts({
      reason: 'explicit_conflict',
      candidates: ['2008-05-01', '2010-01-01'],
    })
    expect(part?.type).toBe('data-clarification')
    expect(
      chatDataPartSchemas.clarification.safeParse({ reason: 'x', candidates: [] }).success,
    ).toBe(false)
  })
})

describe('questionDetailMessages (releitura do histórico)', () => {
  it('resposta gravada vira pergunta + resposta com o id da pergunta', () => {
    const [user, answer] = questionDetailMessages(questionDetail())
    expect(user?.role).toBe('user')
    expect(messageText(user as TekoUIMessage)).toBe('O que diz o art. 76, § 6º do RCTE?')
    expect(answer?.id).toBe(questionDetail().id)
    expect(answerView(answer as TekoUIMessage).reference?.value).toBe('2008-05-01')
  })

  it('recusa gravada vira a mensagem de recusa', () => {
    const messages = questionDetailMessages(
      questionDetail({ status: 'refused', answer: null, refusal: { reason: 'no_evidence' } }),
    )
    expect(answerView(messages[1] as TekoUIMessage).refusal).toEqual({ reason: 'no_evidence' })
  })

  it('pergunta sem desfecho fica só com a mensagem do usuário', () => {
    expect(
      questionDetailMessages(questionDetail({ status: 'aborted', answer: null })),
    ).toHaveLength(1)
  })
})
