import { fc, test } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import {
  ANALYTICS_EVENT_NAMES,
  ANALYTICS_EVENTS,
  type AnalyticsEvent,
  isAnalyticsEventName,
  LatencyBucket,
  latencyBucket,
  parseAnalyticsProperties,
} from './index.ts'

describe('catálogo de eventos', () => {
  it('contém exatamente os eventos do plano', () => {
    expect([...ANALYTICS_EVENT_NAMES].sort()).toEqual(
      [
        'question_asked',
        'reference_date_set',
        'clarification_shown',
        'answer_completed',
        'answer_refused',
        'citation_opened',
        'diff_opened',
        'answer_feedback',
        'quota_reached',
        'provider_fallback',
        'consent_updated',
        'locale_changed',
        'web_vital',
      ].sort(),
    )
  })

  it('reconhece nomes de eventos', () => {
    expect(isAnalyticsEventName('answer_completed')).toBe(true)
    expect(isAnalyticsEventName('question_text')).toBe(false)
    expect(isAnalyticsEventName('constructor')).toBe(false)
    expect(isAnalyticsEventName(1)).toBe(false)
  })

  it('valida propriedades dos eventos', () => {
    const events: AnalyticsEvent[] = [
      { name: 'question_asked', properties: { locale: 'pt-BR', reference_source: 'default' } },
      { name: 'reference_date_set', properties: { source: 'periodo_apuracao' } },
      { name: 'clarification_shown', properties: {} },
      {
        name: 'answer_completed',
        properties: {
          model_family: 'gemini-flash',
          cached: false,
          retrieval_mode: 'lexical_only',
          latency_bucket: '3s_10s',
          trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
        },
      },
      { name: 'answer_refused', properties: { reason: 'out_of_coverage' } },
      {
        name: 'citation_opened',
        properties: { doc_type: 'efd-icms-ipi', version_is_current: true },
      },
      { name: 'diff_opened', properties: {} },
      { name: 'answer_feedback', properties: { rating: 'down', reason: 'wrong_citation' } },
      { name: 'quota_reached', properties: { scope: 'global_daily' } },
      {
        name: 'provider_fallback',
        properties: { from: 'gemini-3.6-flash', to: 'openai/gpt-oss-120b' },
      },
      { name: 'consent_updated', properties: { analytics: false } },
      { name: 'locale_changed', properties: { from: 'pt-BR', to: 'en' } },
      { name: 'web_vital', properties: { name: 'INP', value: 120, rating: 'good' } },
    ]
    for (const event of events) {
      expect(parseAnalyticsProperties(event.name, event.properties)).toEqual(event.properties)
    }
  })

  it('rejeita texto da pergunta e propriedades desconhecidas', () => {
    expect(() =>
      parseAnalyticsProperties('question_asked', {
        locale: 'pt-BR',
        reference_source: 'default',
        question: 'Qual a alíquota?',
      }),
    ).toThrow()
    expect(() => parseAnalyticsProperties('diff_opened', { stableKey: 'go:rcte:art:76' })).toThrow()
    expect(() =>
      parseAnalyticsProperties('citation_opened', {
        doc_type: 'Texto livre com espaços',
        version_is_current: true,
      }),
    ).toThrow()
    expect(() =>
      parseAnalyticsProperties('answer_refused', { reason: 'out_of_coverage', trace_id: 'x' }),
    ).toThrow()
  })

  it('todos os schemas são objetos estritos', () => {
    for (const name of ANALYTICS_EVENT_NAMES) {
      expect(ANALYTICS_EVENTS[name].safeParse({ __extra: 1 }).success).toBe(false)
    }
  })
})

describe('latencyBucket', () => {
  it.each([
    [0, LatencyBucket.Under1s],
    [999, LatencyBucket.Under1s],
    [1000, LatencyBucket.From1To3s],
    [2999, LatencyBucket.From1To3s],
    [3000, LatencyBucket.From3To10s],
    [9999, LatencyBucket.From3To10s],
    [10_000, LatencyBucket.From10To30s],
    [29_999, LatencyBucket.From10To30s],
    [30_000, LatencyBucket.Over30s],
    [100_000, LatencyBucket.Over30s],
  ])('%i ms → %s', (ms, bucket) => {
    expect(latencyBucket(ms)).toBe(bucket)
  })

  test.prop([fc.nat(200_000), fc.nat(200_000)])('é monotônica', (a, b) => {
    const order = Object.values(LatencyBucket)
    const [low, high] = a <= b ? [a, b] : [b, a]
    expect(order.indexOf(latencyBucket(low))).toBeLessThanOrEqual(
      order.indexOf(latencyBucket(high)),
    )
  })
})
