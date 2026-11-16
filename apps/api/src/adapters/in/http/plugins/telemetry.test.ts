import { context, propagation, trace } from '@opentelemetry/api'
import { InMemoryLogRecordExporter } from '@opentelemetry/sdk-logs'
import { AggregationTemporality, InMemoryMetricExporter } from '@opentelemetry/sdk-metrics'
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-node'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { startTelemetry, type TelemetryRuntime } from '#adapters/out/telemetry/sdk.ts'
import type { Container } from '#app/container.ts'
import type { BackgroundTaskOptions } from '#app/ports/background-tasks.ts'
import { recordingTelemetry } from '#app/ports/testing/recording-telemetry.ts'
import { registerProblemHandlers } from '../problem/error-handler.ts'
import { decorateContainer } from './container.ts'
import {
  flushesTelemetry,
  type HttpTelemetry,
  registerTelemetry,
  TELEMETRY_FLUSH_TIMEOUT_MS,
  TRACE_ID_HEADER,
  traceIdFromTraceparent,
} from './telemetry.ts'

const BROWSER_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
/** `traceparent` do navegador, com a flag `sampled` desligada (o navegador não grava spans). */
const TRACEPARENT = `00-${BROWSER_TRACE_ID}-00f067aa0ba902b7-00`
const HEX_32 = /^[0-9a-f]{32}$/

interface Harness {
  readonly app: FastifyInstance
  readonly tasks: { name: string; task: Promise<unknown>; options: BackgroundTaskOptions }[]
  readonly metrics: ReturnType<typeof recordingTelemetry>
}

async function harness(telemetry: HttpTelemetry | undefined): Promise<Harness> {
  const tasks: Harness['tasks'] = []
  const metrics = recordingTelemetry()
  const container = {
    telemetry: metrics,
    backgroundTasks: {
      run: (name: string, task: Promise<unknown>, options: BackgroundTaskOptions) => {
        tasks.push({ name, task, options })
      },
      pending: () => 0,
      drain: async () => 0,
    },
  } as unknown as Container
  const app = Fastify({ genReqId: () => 'req-1' })
  registerProblemHandlers(app)
  decorateContainer(app, container)
  await registerTelemetry(app, telemetry)
  app.get('/api/v1/things/:id', async (request) => ({ traceId: request.traceId }))
  app.get('/healthz', async () => ({ status: 'ok' }))
  await app.ready()
  return { app, tasks, metrics }
}

describe('com o SDK (plugin do @fastify/otel)', () => {
  let runtime: TelemetryRuntime
  let spans: InMemorySpanExporter
  let current: Harness

  beforeAll(async () => {
    spans = new InMemorySpanExporter()
    runtime = startTelemetry({
      identity: { serviceVersion: '0.1.0', gitSha: 'abc1234', environment: 'ci', region: null },
      otlp: null,
      exporters: {
        spans,
        logs: new InMemoryLogRecordExporter(),
        metrics: new InMemoryMetricExporter(AggregationTemporality.DELTA),
      },
    })
    current = await harness({ plugin: runtime.fastifyPlugin, flush: runtime.flush })
  })

  afterAll(async () => {
    await current.app.close()
    await runtime.shutdown()
    trace.disable()
    context.disable()
    propagation.disable()
  })

  afterEach(async () => {
    // Esvazia o buffer do BatchSpanProcessor para o próximo teste começar do zero.
    await runtime.flush()
    current.tasks.length = 0
    spans.reset()
  })

  it('reaproveita o trace_id do traceparent (ignorando sampled=0) e devolve x-trace-id', async () => {
    const res = await current.app.inject({
      url: '/api/v1/things/42',
      headers: { traceparent: TRACEPARENT },
    })
    expect(res.headers[TRACE_ID_HEADER]).toBe(BROWSER_TRACE_ID)
    expect(res.json()).toEqual({ traceId: BROWSER_TRACE_ID })
    await Promise.all(current.tasks.map((task) => task.task))
    const request = spans.getFinishedSpans().find((span) => span.name === 'request')
    expect(request?.spanContext().traceId).toBe(BROWSER_TRACE_ID)
    expect(request?.attributes['http.route']).toBe('/api/v1/things/:id')
  })

  it('ao fim da requisição de /api, o flush vai para BackgroundTasks com teto de 500 ms', async () => {
    await current.app.inject({ url: '/api/v1/things/1' })
    expect(current.tasks.map(({ name, options }) => ({ name, options }))).toEqual([
      { name: 'telemetry-flush', options: { timeoutMs: TELEMETRY_FLUSH_TIMEOUT_MS } },
    ])
    await current.tasks[0]?.task
    expect(spans.getFinishedSpans().length).toBeGreaterThan(0)
  })

  it('sem traceparent, o trace_id é o do span novo', async () => {
    const res = await current.app.inject({ url: '/api/v1/things/1' })
    await Promise.all(current.tasks.map((task) => task.task))
    const traceId = spans.getFinishedSpans()[0]?.spanContext().traceId
    expect(res.headers[TRACE_ID_HEADER]).toBe(traceId)
  })

  it('Problem Details leva o mesmo traceId do header', async () => {
    const res = await current.app.inject({
      url: '/api/v1/nada',
      headers: { traceparent: TRACEPARENT },
    })
    expect(res.statusCode).toBe(404)
    expect(res.headers[TRACE_ID_HEADER]).toBe(BROWSER_TRACE_ID)
    expect(res.json()).toMatchObject({ code: 'not_found', traceId: BROWSER_TRACE_ID })
  })

  it('/healthz: x-trace-id, mas sem span exportado e sem flush', async () => {
    const res = await current.app.inject({ url: '/healthz' })
    expect(res.headers[TRACE_ID_HEADER]).toMatch(HEX_32)
    expect(current.tasks).toHaveLength(0)
    await runtime.flush()
    expect(spans.getFinishedSpans()).toHaveLength(0)
  })

  it('grava a duração de toda requisição com a rota declarada', async () => {
    current.metrics.calls.length = 0
    await current.app.inject({ method: 'GET', url: '/api/v1/things/7' })
    expect(current.metrics.of('httpRequest')).toEqual([
      [
        {
          method: 'GET',
          route: '/api/v1/things/:id',
          statusCode: 200,
          durationSeconds: expect.any(Number),
        },
      ],
    ])
  })
})

describe('sem o SDK', () => {
  it('x-trace-id vem do traceparent ou é aleatório; 404 sem rota; nada de flush', async () => {
    const { app, tasks, metrics } = await harness(undefined)
    const withHeader = await app.inject({
      url: '/api/v1/things/1',
      headers: { traceparent: TRACEPARENT },
    })
    expect(withHeader.headers[TRACE_ID_HEADER]).toBe(BROWSER_TRACE_ID)
    const random = await app.inject({ url: '/api/v1/nada' })
    expect(random.headers[TRACE_ID_HEADER]).toMatch(HEX_32)
    expect(random.headers[TRACE_ID_HEADER]).not.toBe(BROWSER_TRACE_ID)
    expect(random.json()).toMatchObject({ traceId: random.headers[TRACE_ID_HEADER] })
    expect(metrics.of('httpRequest')[1]?.[0]).toMatchObject({ route: null, statusCode: 404 })
    expect(tasks).toHaveLength(0)
    await app.close()
  })
})

describe('auxiliares', () => {
  it.each([
    [TRACEPARENT, BROWSER_TRACE_ID],
    [` ${TRACEPARENT} `, BROWSER_TRACE_ID],
    [`00-${'0'.repeat(32)}-00f067aa0ba902b7-01`, null],
    [`01-${BROWSER_TRACE_ID}-00f067aa0ba902b7-01`, null],
    [`00-${BROWSER_TRACE_ID.toUpperCase()}-00f067aa0ba902b7-01`, null],
    ['lixo', null],
    [undefined, null],
    [['a', 'b'], null],
  ])('traceIdFromTraceparent(%o) → %s', (header, expected) => {
    expect(traceIdFromTraceparent(header)).toBe(expected)
  })

  it.each([
    ['/api/v1/questions', true],
    ['/api/v1/questions?x=1', true],
    ['/api/healthz', false],
    ['/api/healthz?probe=1', false],
    ['/healthz', false],
    ['/pt-BR/', false],
    ['/apiv1', false],
  ])('flushesTelemetry(%s) → %s', (url, expected) => {
    expect(flushesTelemetry(url)).toBe(expected)
  })
})
