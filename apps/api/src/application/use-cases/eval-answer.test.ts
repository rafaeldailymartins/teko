import { describe, expect, it } from 'vitest'
import type { LlmEvent, LlmModel, LlmRequest } from '../ports/llm-port.ts'
import { createProviderRouter } from '../services/provider-router.ts'
import { createEvalAnswer } from './eval-answer.ts'
import type { RetrieveEvidence } from './retrieve-evidence.ts'

describe('createEvalAnswer', () => {
  it('redige a pergunta e devolve os chunks e o resultado', async () => {
    const seen: string[] = []
    const retrieve: RetrieveEvidence = async (command) => {
      seen.push(command.questionText)
      return {
        outcome: 'refused',
        reason: 'no_evidence',
        reference: {
          value: '2024-01-01',
          source: 'explicit',
          periodBoundaryInside: false,
          alternatives: [],
          periodo: null,
        },
        coverage: [],
        mode: 'hybrid',
      }
    }
    const unused: LlmModel = {
      provider: 'fake',
      model: 'fake',
      zeroDataRetention: true,
      stream: (_request: LlmRequest): AsyncIterable<LlmEvent> => {
        throw new Error('não deveria chamar')
      },
    }
    const evalAnswer = createEvalAnswer({
      retrieveEvidence: retrieve,
      router: createProviderRouter({ models: [unused], clock: { now: () => new Date(0) } }),
      corpusVersion: async () => 1,
      nowMs: () => 0,
      timeoutMs: 1000,
    })
    const result = await evalAnswer({
      question: 'Contato: ana.souza@example.com',
      referenceInput: { referenceDate: '2024-01-01' },
      referenceSource: 'explicit',
      families: [],
      locale: 'en',
      zeroDataRetention: false,
    })
    expect(seen).toEqual(['Contato: [EMAIL]'])
    expect(result.chunks.map((chunk) => chunk.type)).toEqual([
      'start',
      'data-reference-date',
      'data-refusal',
    ])
    expect(result.outcome).toMatchObject({ refusal: { reason: 'no_evidence' } })
  })
})
