import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { type InMemoryTracing, registerInMemoryTracing } from './testing/in-memory-tracing.ts'
import { hasRecordingSpan, tracedIterable, withSpan } from './tracing.ts'

let tracing: InMemoryTracing

beforeAll(() => {
  tracing = registerInMemoryTracing()
})

afterAll(async () => {
  await tracing.stop()
})

beforeEach(() => {
  tracing.exporter.reset()
})

const tracer = () => trace.getTracer('teste')

describe('withSpan', () => {
  it('abre um span de cliente filho do ativo e o fecha com o resultado', async () => {
    const result = await tracer().startActiveSpan('request', async (parent) => {
      const value = await withSpan('pg SELECT', { 'db.operation.name': 'SELECT' }, async () => {
        expect(hasRecordingSpan()).toBe(true)
        return 42
      })
      parent.end()
      return value
    })
    expect(result).toBe(42)
    const [child, parent] = tracing.spans()
    expect(child?.name).toBe('pg SELECT')
    expect(child?.kind).toBe(SpanKind.CLIENT)
    expect(child?.attributes).toEqual({ 'db.operation.name': 'SELECT' })
    expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId)
    expect(child?.status.code).toBe(SpanStatusCode.UNSET)
  })

  it('falha: status de erro com o tipo, sem a mensagem, e o erro segue', async () => {
    await expect(
      withSpan('rerank', {}, async () => {
        throw new TypeError('valor com PII')
      }),
    ).rejects.toThrow('valor com PII')
    const [span] = tracing.spans()
    expect(span?.status).toEqual({ code: SpanStatusCode.ERROR, message: 'TypeError' })
    expect(span?.attributes['error.type']).toBe('TypeError')
    expect(JSON.stringify(span?.events)).not.toContain('PII')
  })

  it('erro que não é Error vira error.type unknown', async () => {
    await expect(withSpan('x', {}, () => Promise.reject('texto'))).rejects.toBe('texto')
    expect(tracing.spans()[0]?.attributes['error.type']).toBe('unknown')
  })
})

describe('tracedIterable', () => {
  async function drain(iterable: AsyncIterable<number>): Promise<number[]> {
    const out: number[] = []
    for await (const value of iterable) {
      out.push(value)
    }
    return out
  }

  it('cobre o stream inteiro e deixa o span para atributos de fim', async () => {
    const values = await drain(
      tracedIterable('chat m', { 'gen_ai.request.model': 'm' }, async function* (span) {
        yield 1
        span.setAttribute('gen_ai.usage.output_tokens', 2)
        yield 2
      }),
    )
    expect(values).toEqual([1, 2])
    const [span] = tracing.spans()
    expect(span?.attributes).toEqual({
      'gen_ai.request.model': 'm',
      'gen_ai.usage.output_tokens': 2,
    })
  })

  it('falha no meio fecha o span com erro', async () => {
    const failing = tracedIterable('chat m', {}, async function* () {
      yield 1
      throw new RangeError('caiu')
    })
    await expect(drain(failing)).rejects.toThrow('caiu')
    expect(tracing.spans()[0]?.status.code).toBe(SpanStatusCode.ERROR)
  })

  it('consumidor que abandona o stream também fecha o span', async () => {
    for await (const value of tracedIterable('chat m', {}, async function* () {
      yield 1
      yield 2
    })) {
      if (value === 1) {
        break
      }
    }
    expect(tracing.spans()).toHaveLength(1)
  })
})

describe('hasRecordingSpan', () => {
  it('falso fora de span', () => {
    expect(hasRecordingSpan()).toBe(false)
  })
})
