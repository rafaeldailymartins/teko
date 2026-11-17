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

  it('sem as chaves do Langfuse (CI, testes), nenhum span processor extra', () => {
    expect(additionalSpanProcessors(parseEnv(DEV))).toEqual([])
  })

  it('com as chaves, o LangfuseSpanProcessor; LLM_TRACING_BACKEND=off desliga', async () => {
    const keys = { LANGFUSE_PUBLIC_KEY: 'pk-lf-a', LANGFUSE_SECRET_KEY: 'sk-lf-b' }
    const processors = additionalSpanProcessors(parseEnv({ ...DEV, ...keys }))
    expect(processors.map((processor) => processor.constructor.name)).toEqual([
      'LangfuseSpanProcessor',
    ])
    await Promise.all(processors.map((processor) => processor.shutdown()))
    expect(
      additionalSpanProcessors(parseEnv({ ...DEV, ...keys, LLM_TRACING_BACKEND: 'off' })),
    ).toEqual([])
  })
})
