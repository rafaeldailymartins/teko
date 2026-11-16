import { context, propagation, trace } from '@opentelemetry/api'
import { afterEach, describe, expect, it } from 'vitest'
import { noopTelemetry } from '#app/ports/telemetry.ts'
import { parseEnv } from './config/env.ts'
import { additionalSpanProcessors, startInstrumentation } from './instrumentation.ts'

const DEV = { APP_ENV: 'development', WEB_ORIGIN: 'http://localhost:3000' } as const

afterEach(() => {
  trace.disable()
  context.disable()
  propagation.disable()
})

describe('startInstrumentation', () => {
  it('sem OTEL_EXPORTER_OTLP_ENDPOINT, registra o provider global sem exportar nada', async () => {
    const runtime = startInstrumentation(parseEnv(DEV))
    expect(runtime.exporting).toBe(false)
    expect(runtime.telemetry).toBe(noopTelemetry)
    const span = trace.getTracer('t').startSpan('x', { attributes: { 'url.path': '/api/v1/me' } })
    expect(span.isRecording()).toBe(true)
    span.end()
    await runtime.shutdown()
  })

  it('com o endpoint, exporta com os headers e a região da Vercel no resource', async () => {
    const runtime = startInstrumentation(
      parseEnv({
        ...DEV,
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9',
        OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic%20eA%3D%3D',
        VERCEL_REGION: 'gru1',
      }),
    )
    expect(runtime.exporting).toBe(true)
    expect(runtime.logSink).not.toBeNull()
  })

  it('nenhum span processor extra por enquanto (o do Langfuse entra no add-llm-tracing-langfuse)', () => {
    expect(additionalSpanProcessors(parseEnv(DEV))).toEqual([])
  })
})
