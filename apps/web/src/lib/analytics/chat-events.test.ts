import { type AnalyticsEvent, parseAnalyticsProperties } from '@teko/shared/analytics'
import type { AnswerMeta, FinishMetadata } from '@teko/shared/contracts'
import { ErrorCode } from '@teko/shared/errors'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.ts'
import type { TekoMessagePart, TekoUIMessage } from '../chat/parts.ts'
import { answerEvents, captureEvents, modelFamily, quotaReachedEvent } from './chat-events.ts'

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736'

const META: AnswerMeta = {
  corpusVersion: 3,
  retrievalMode: 'hybrid',
  uncoveredFamilies: [],
  provider: 'gemini',
  fallbackFrom: null,
  cached: false,
}

function finish(model: string, traceId = TRACE): FinishMetadata {
  return { usage: { inputTokens: 10, outputTokens: 20 }, model, traceId }
}

function assistant(parts: TekoMessagePart[], metadata?: FinishMetadata): TekoUIMessage {
  return metadata === undefined
    ? { id: 'a', role: 'assistant', parts }
    : { id: 'a', role: 'assistant', parts, metadata }
}

function expectValid(events: readonly AnalyticsEvent[]): void {
  for (const event of events) {
    expect(parseAnalyticsProperties(event.name, event.properties)).toEqual(event.properties)
  }
}

describe('modelFamily', () => {
  it.each([
    ['gemini-3.6-flash', 'gemini-flash'],
    ['openai/gpt-oss-120b', 'gpt-oss-120b'],
    ['Llama-3.3-70B-Versatile', 'llama-70b-versatile'],
    ['2', '2'],
  ])('%s → %s', (model, family) => {
    expect(modelFamily(model)).toBe(family)
  })
})

describe('answerEvents', () => {
  it('resposta do stream: answer_completed com família, faixa de latência e trace_id', () => {
    const events = answerEvents(
      assistant(
        [
          { type: 'data-meta', data: META },
          { type: 'text', text: 'Resposta com dados' },
        ],
        finish('gemini-3.6-flash'),
      ),
      4200,
    )
    expect(events).toEqual([
      {
        name: 'answer_completed',
        properties: {
          model_family: 'gemini-flash',
          cached: false,
          retrieval_mode: 'hybrid',
          latency_bucket: '3s_10s',
          trace_id: TRACE,
        },
      },
    ])
    expectValid(events)
  })

  it('resposta do cache, sem metadados do finish: família pelo provedor, sem trace_id', () => {
    const events = answerEvents(
      assistant([{ type: 'data-meta', data: { ...META, cached: true, provider: 'groq' } }]),
      -5,
    )
    expect(events).toEqual([
      {
        name: 'answer_completed',
        properties: {
          model_family: 'groq',
          cached: true,
          retrieval_mode: 'hybrid',
          latency_bucket: 'lt_1s',
        },
      },
    ])
    expectValid(events)
  })

  it('fallback: answer_completed e provider_fallback', () => {
    const events = answerEvents(
      assistant(
        [
          {
            type: 'data-meta',
            data: { ...META, provider: 'groq', fallbackFrom: 'gemini-3.6-flash' },
          },
        ],
        finish('openai/gpt-oss-120b'),
      ),
      12_000,
    )
    expect(events.map((event) => event.name)).toEqual(['answer_completed', 'provider_fallback'])
    expect(events[1]).toEqual({
      name: 'provider_fallback',
      properties: { from: 'gemini-3.6-flash', to: 'openai/gpt-oss-120b' },
    })
    expectValid(events)
  })

  it('recusa: answer_refused com o motivo; trace_id fora do formato fica de fora', () => {
    const events = answerEvents(
      assistant(
        [{ type: 'data-refusal', data: { reason: 'out_of_coverage' } }],
        finish('x', 'nao-hex'),
      ),
      100,
    )
    expect(events).toEqual([{ name: 'answer_refused', properties: { reason: 'out_of_coverage' } }])
    expectValid(events)
  })

  it('pedido de esclarecimento: clarification_shown', () => {
    const events = answerEvents(
      assistant([
        {
          type: 'data-clarification',
          data: { reason: 'ambiguous_text', candidates: ['2024-01-01', '2025-01-01'] },
        },
      ]),
      100,
    )
    expect(events).toEqual([{ name: 'clarification_shown', properties: {} }])
  })

  it('mensagem sem desfecho não gera evento', () => {
    expect(answerEvents(assistant([{ type: 'text', text: 'parcial' }]), 100)).toEqual([])
  })
})

describe('quotaReachedEvent', () => {
  it('cota estourada com escopo vira quota_reached', () => {
    const error = new ApiError({
      code: ErrorCode.QuotaExceeded,
      status: 429,
      problem: {
        type: 'about:blank',
        title: 'Cota',
        status: 429,
        code: ErrorCode.QuotaExceeded,
        traceId: TRACE,
        meta: { scope: 'user_daily', resetAt: '2026-11-18T03:00:00.000Z' },
      },
    })
    const event = quotaReachedEvent(error)
    expect(event).toEqual({ name: 'quota_reached', properties: { scope: 'user_daily' } })
    expectValid(event === null ? [] : [event])
  })

  it.each([
    ['sem erro', undefined],
    ['outro erro', new ApiError({ code: ErrorCode.Internal, status: 500 })],
    ['erro do stream', new Error('{"code":"quota_exceeded","retryable":false}')],
  ])('%s: nada', (_case, error) => {
    expect(quotaReachedEvent(error)).toBeNull()
  })
})

describe('captureEvents', () => {
  it('repassa cada evento ao adapter', () => {
    const capture = vi.fn()
    captureEvents({ capture }, [
      { name: 'diff_opened', properties: {} },
      { name: 'clarification_shown', properties: {} },
    ])
    expect(capture.mock.calls).toEqual([
      ['diff_opened', {}],
      ['clarification_shown', {}],
    ])
  })
})
