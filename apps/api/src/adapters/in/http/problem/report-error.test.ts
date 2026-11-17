import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationError } from '#app/errors.ts'
import type { BackgroundTasks } from '#app/ports/background-tasks.ts'
import {
  type ErrorReportContext,
  type ErrorReporterPort,
  noopErrorReporter,
} from '#app/ports/error-reporter.ts'
import { registerProblemHandlers } from './error-handler.ts'
import { ERROR_FLUSH_TIMEOUT_MS, reportUnexpectedErrors } from './report-error.ts'

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c'

function spyReporter() {
  const reports: { error: unknown; context: ErrorReportContext }[] = []
  const flush = vi.fn(async () => {})
  const reporter: ErrorReporterPort = {
    enabled: true,
    report: (error, context) => {
      reports.push({ error, context })
    },
    flush,
    shutdown: async () => {},
  }
  return { reporter, reports, flush }
}

function spyTasks() {
  const run = vi.fn<BackgroundTasks['run']>()
  const tasks: BackgroundTasks = { run, pending: () => 0, drain: async () => 0 }
  return { tasks, run }
}

let app: FastifyInstance | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

async function appWith(errorReporter: ErrorReporterPort, backgroundTasks: BackgroundTasks) {
  const instance = Fastify({ genReqId: () => 'req-1' })
  instance.decorateRequest('traceId', '')
  instance.addHook('onRequest', async (request) => {
    request.traceId = TRACE_ID
  })
  registerProblemHandlers(
    instance,
    undefined,
    reportUnexpectedErrors({ errorReporter, backgroundTasks }),
  )
  instance.get('/boom/:id', async () => {
    throw new Error('bug com maria@example.com')
  })
  instance.get('/paused', async () => {
    throw new ApplicationError({ code: 'service_paused' })
  })
  instance.get('/quota', async () => {
    throw new ApplicationError({ code: 'stream_busy' })
  })
  await instance.ready()
  app = instance
  return instance
}

describe('reportUnexpectedErrors', () => {
  it('erro inesperado: reporta com trace_id e rota declarada e agenda o flush de 500 ms', async () => {
    const { reporter, reports, flush } = spyReporter()
    const { tasks, run } = spyTasks()
    const res = await (await appWith(reporter, tasks)).inject({ url: '/boom/42?q=segredo' })

    expect(res.statusCode).toBe(500)
    expect(reports).toHaveLength(1)
    expect(reports[0]?.context).toEqual({
      traceId: TRACE_ID,
      method: 'GET',
      route: '/boom/:id',
      statusCode: 500,
    })
    expect(flush).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('error-flush', expect.any(Promise), {
      timeoutMs: ERROR_FLUSH_TIMEOUT_MS,
    })
    expect(ERROR_FLUSH_TIMEOUT_MS).toBe(500)
  })

  it('erros esperados (4xx e 503 deliberados) não são reportados nem agendam flush', async () => {
    const { reporter, reports } = spyReporter()
    const { tasks, run } = spyTasks()
    const instance = await appWith(reporter, tasks)
    for (const url of ['/paused', '/quota', '/nada']) {
      const res = await instance.inject({ url })
      expect(res.statusCode).toBeGreaterThanOrEqual(400)
    }
    expect(reports).toEqual([])
    expect(run).not.toHaveBeenCalled()
  })

  it('sem destino configurado, nem o flush é agendado', async () => {
    const { tasks, run } = spyTasks()
    const res = await (await appWith(noopErrorReporter, tasks)).inject({ url: '/boom/1' })
    expect(res.statusCode).toBe(500)
    expect(run).not.toHaveBeenCalled()
  })

  it('sem trace_id ainda (falha antes da telemetria), usa o request id', () => {
    const { reporter, reports } = spyReporter()
    const { tasks } = spyTasks()
    const hook = reportUnexpectedErrors({ errorReporter: reporter, backgroundTasks: tasks })
    hook(
      new Error('x'),
      {
        traceId: '',
        id: 'req-9',
        method: 'POST',
        routeOptions: {},
      } as unknown as Parameters<typeof hook>[1],
      500,
    )
    expect(reports[0]?.context).toEqual({
      traceId: 'req-9',
      method: 'POST',
      route: null,
      statusCode: 500,
    })
  })

  it('um destino que lança não troca a resposta', async () => {
    const reporter: ErrorReporterPort = {
      ...noopErrorReporter,
      enabled: true,
      report: () => {
        throw new Error('sdk')
      },
    }
    const { tasks } = spyTasks()
    const res = await (await appWith(reporter, tasks)).inject({ url: '/boom/1' })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toMatchObject({ code: 'internal' })
  })
})
