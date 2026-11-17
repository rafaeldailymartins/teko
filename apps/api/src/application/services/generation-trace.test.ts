import { describe, expect, it } from 'vitest'
import { recordingLlmTracing } from '../ports/testing/recording-llm-tracing.ts'
import { interruptionOf, trackGeneration } from './generation-trace.ts'
import { createQueryTracer } from './trace-sampler.ts'

describe('interruptionOf', () => {
  it('cancelamento, erro com nome e o que não é Error', () => {
    const aborted = new AbortController()
    aborted.abort(new Error('saiu'))
    expect(interruptionOf(new Error('x'), aborted.signal)).toBe('aborted')
    const live = new AbortController().signal
    expect(interruptionOf(new TypeError('x'), live)).toBe('TypeError')
    expect(interruptionOf('texto', live)).toBe('unknown')
  })
})

describe('trackGeneration', () => {
  it('sem start, o end não cria nada; depois do end, um segundo end é ignorado', async () => {
    const port = recordingLlmTracing()
    const trace = await createQueryTracer({
      port,
      sampler: { shouldSample: async () => true },
    }).start({
      questionId: 'q',
      userId: 'u',
      question: 'x',
      locale: 'pt-BR',
      families: [],
      referenceDate: '2026-11-01',
      referenceSource: 'explicit',
      corpusVersion: null,
      promptVersion: 'p',
      cached: false,
      startedAtMs: 0,
    })
    const request = { name: 'answer', input: 'p', temperature: 0, maxOutputTokens: 10 } as const
    const tracker = trackGeneration(trace, request, () => 9)
    tracker.end({ inputTokens: 0, outputTokens: 0 }, null, 'aborted')
    expect(port.queries[0]?.generations).toEqual([])
    tracker.start({
      type: 'start',
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      fallbackFrom: null,
      attemptStartedAtMs: 1,
    })
    tracker.end({ inputTokens: 1000, outputTokens: 0 }, null, null)
    tracker.end({ inputTokens: 5, outputTokens: 5 }, 3, null)
    expect(port.queries[0]?.generations).toHaveLength(1)
    expect(port.queries[0]?.generations[0]?.end).toEqual({
      error: null,
      usage: { inputTokens: 1000, outputTokens: 0 },
      cost: { input: 0.00015, output: 0, total: 0.00015 },
      firstTokenAtMs: null,
      output: null,
      endedAtMs: 9,
    })
  })
})
