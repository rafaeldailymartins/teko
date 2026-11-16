import { ROOT_CONTEXT, SpanKind, TraceFlags, trace } from '@opentelemetry/api'
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SamplingDecision,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node'
import { describe, expect, it } from 'vitest'
import { isHealthCheck, TekoSampler } from './sampler.ts'

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const PARENT_SPAN_ID = '00f067aa0ba902b7'

function parent(options: { readonly remote: boolean; readonly sampled: boolean }) {
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId: TRACE_ID,
    spanId: PARENT_SPAN_ID,
    traceFlags: options.sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
    isRemote: options.remote,
  })
}

const sampler = new TekoSampler()
const decide = (context = ROOT_CONTEXT, attributes = {}) =>
  sampler.shouldSample(context, TRACE_ID, 'request', SpanKind.SERVER, attributes).decision

describe('TekoSampler', () => {
  it.each([
    [{ 'url.path': '/healthz' }],
    [{ 'url.path': '/api/healthz?x=1' }],
    [{ 'http.route': '/healthz' }],
  ])('descarta o health check (%o)', (attributes) => {
    expect(decide(ROOT_CONTEXT, attributes)).toBe(SamplingDecision.NOT_RECORD)
  })

  it('amostra o resto, sem pai', () => {
    expect(decide(ROOT_CONTEXT, { 'url.path': '/api/v1/questions' })).toBe(
      SamplingDecision.RECORD_AND_SAMPLED,
    )
    expect(decide()).toBe(SamplingDecision.RECORD_AND_SAMPLED)
  })

  it('ignora a flag sampled=0 do traceparent do navegador (pai remoto)', () => {
    expect(decide(parent({ remote: true, sampled: false }))).toBe(
      SamplingDecision.RECORD_AND_SAMPLED,
    )
  })

  it('segue o pai local descartado (filhos do /healthz) e o pai local amostrado', () => {
    expect(decide(parent({ remote: false, sampled: false }))).toBe(SamplingDecision.NOT_RECORD)
    expect(decide(parent({ remote: false, sampled: true }))).toBe(
      SamplingDecision.RECORD_AND_SAMPLED,
    )
  })

  it('isHealthCheck só olha url.path e http.route', () => {
    expect(isHealthCheck({ 'url.path': '/healthzx' })).toBe(false)
    expect(isHealthCheck({ 'http.target': '/healthz' })).toBe(false)
    expect(isHealthCheck({ 'url.path': 42 })).toBe(false)
  })

  it('tem descrição', () => {
    expect(sampler.toString()).toContain('TekoSampler')
  })

  it('no provider: o span mantém o trace_id do navegador e sai gravado mesmo com sampled=0', () => {
    const exporter = new InMemorySpanExporter()
    const provider = new NodeTracerProvider({
      sampler,
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })
    const tracer = provider.getTracer('teste')
    tracer
      .startSpan(
        'request',
        { attributes: { 'url.path': '/api/v1/me' } },
        parent({ remote: true, sampled: false }),
      )
      .end()
    tracer.startSpan('request', { attributes: { 'url.path': '/healthz' } }).end()
    const [span, ...others] = exporter.getFinishedSpans()
    expect(others).toHaveLength(0)
    expect(span?.spanContext().traceId).toBe(TRACE_ID)
    expect(span?.parentSpanContext?.spanId).toBe(PARENT_SPAN_ID)
    expect(span?.spanContext().traceFlags).toBe(TraceFlags.SAMPLED)
  })
})
