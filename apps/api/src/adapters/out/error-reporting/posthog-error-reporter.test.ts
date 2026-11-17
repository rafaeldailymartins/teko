import { cpfCheckDigits } from '@teko/shared/pii'
import { PostHog } from 'posthog-node'
import { describe, expect, it, vi } from 'vitest'
import {
  createPosthogErrorReporter,
  type ExceptionClient,
  onlyExceptions,
  POSTHOG_EU_HOST,
} from './posthog-error-reporter.ts'
import { ScrubbedError } from './scrub.ts'

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c'
const CPF = `529982247${cpfCheckDigits('529982247')}`
const CONTEXT = {
  traceId: TRACE_ID,
  method: 'POST',
  route: '/api/v1/questions',
  statusCode: 500,
} as const

function fakeClient(send: () => Promise<void> = async () => {}) {
  const calls: Parameters<ExceptionClient['captureExceptionImmediate']>[] = []
  const client: ExceptionClient = {
    captureExceptionImmediate: (...args) => {
      calls.push(args)
      return send()
    },
    shutdown: vi.fn(async () => {}),
  }
  return { client, calls }
}

describe('createPosthogErrorReporter', () => {
  it('manda o erro sem PII, com trace_id, rota, release e sem perfil de pessoa', async () => {
    const { client, calls } = fakeClient()
    const reporter = createPosthogErrorReporter({
      projectKey: 'phc_x',
      release: 'teko@abc1234',
      appEnv: 'staging',
      client,
    })
    expect(reporter.enabled).toBe(true)
    reporter.report(new Error(`falhou com ${CPF}`), CONTEXT)
    await reporter.flush()

    expect(calls).toHaveLength(1)
    const [error, distinctId, properties] = calls[0] ?? []
    expect(error).toBeInstanceOf(ScrubbedError)
    expect((error as Error).message).toBe('falhou com [CPF]')
    expect(distinctId).toBe(TRACE_ID)
    expect(properties).toEqual({
      $process_person_profile: false,
      trace_id: TRACE_ID,
      http_method: 'POST',
      http_route: '/api/v1/questions',
      http_status_code: 500,
      error_code: null,
      release: 'teko@abc1234',
      app_env: 'staging',
      service: 'teko-api',
    })
  })

  it('flush espera os envios em andamento e nunca rejeita', async () => {
    let finish: () => void = () => {}
    const { client } = fakeClient(
      () =>
        new Promise<void>((_resolve, reject) => {
          finish = () => reject(new Error('rede'))
        }),
    )
    const reporter = createPosthogErrorReporter({
      projectKey: 'phc_x',
      release: 'teko@0.1.0',
      appEnv: 'production',
      client,
    })
    reporter.report(new Error('x'), CONTEXT)
    let flushed = false
    const flush = reporter.flush().then(() => {
      flushed = true
    })
    await Promise.resolve()
    expect(flushed).toBe(false)
    finish()
    await flush
    expect(flushed).toBe(true)
    await expect(reporter.flush()).resolves.toBeUndefined()
  })

  it('um SDK que lança não derruba quem reporta', async () => {
    const client: ExceptionClient = {
      captureExceptionImmediate: () => {
        throw new Error('sdk')
      },
      shutdown: async () => {
        throw new Error('sdk')
      },
    }
    const reporter = createPosthogErrorReporter({
      projectKey: 'phc_x',
      release: 'teko@0.1.0',
      appEnv: 'production',
      client,
    })
    expect(() => reporter.report(new Error('x'), CONTEXT)).not.toThrow()
    await expect(reporter.shutdown(10)).resolves.toBeUndefined()
  })

  it('shutdown espera os envios e encerra o cliente com o teto', async () => {
    const { client } = fakeClient()
    const reporter = createPosthogErrorReporter({
      projectKey: 'phc_x',
      release: 'teko@0.1.0',
      appEnv: 'production',
      client,
    })
    await reporter.shutdown(250)
    expect(client.shutdown).toHaveBeenCalledWith(250)
  })
})

describe('onlyExceptions', () => {
  it('só deixa sair $exception', () => {
    const event = { event: '$exception', distinctId: TRACE_ID }
    expect(onlyExceptions(event)).toBe(event)
    expect(onlyExceptions({ event: '$identify', distinctId: TRACE_ID })).toBeNull()
  })

  it('tira as linhas de código-fonte de cada frame e mantém o resto', () => {
    const frame = {
      filename: 'dist/server.mjs',
      lineno: 10,
      pre_context: ['a'],
      context_line: "throw new Error('CPF ' + cpf)",
      post_context: ['b'],
    }
    const event = {
      event: '$exception',
      distinctId: TRACE_ID,
      properties: {
        trace_id: TRACE_ID,
        $exception_list: [
          { type: 'Error', stacktrace: { type: 'raw', frames: [frame, 'x'] } },
          { type: 'Error', stacktrace: { type: 'raw' } },
          { type: 'Error' },
          'y',
        ],
      },
    }
    expect(onlyExceptions(event)?.properties).toEqual({
      trace_id: TRACE_ID,
      $exception_list: [
        {
          type: 'Error',
          stacktrace: { type: 'raw', frames: [{ filename: 'dist/server.mjs', lineno: 10 }, 'x'] },
        },
        { type: 'Error', stacktrace: { type: 'raw' } },
        { type: 'Error' },
        'y',
      ],
    })
    expect(frame.context_line).toBeDefined()
  })
})

describe('com o posthog-node de verdade (fetch falso)', () => {
  it('um único POST à UE com o $exception já sem PII', async () => {
    const requests: { url: string; body: string }[] = []
    const fetch = vi.fn(async (url: string, options: { body?: unknown }) => {
      requests.push({ url, body: String(options.body) })
      return { status: 200, text: async () => '{}', json: async () => ({}) }
    })
    const client = new PostHog(`phc_${'a'.repeat(43)}`, {
      host: POSTHOG_EU_HOST,
      flushAt: 20,
      flushInterval: 0,
      disableGeoip: true,
      disableCompression: true,
      fetch,
      before_send: onlyExceptions,
    })
    const reporter = createPosthogErrorReporter({
      projectKey: 'phc_x',
      release: 'teko@abc1234',
      appEnv: 'staging',
      client,
    })
    reporter.report(new Error(`falhou para maria@example.com e ${CPF}`), CONTEXT)
    await reporter.flush()
    await reporter.shutdown(100)

    expect(requests.length).toBeGreaterThan(0)
    for (const request of requests) {
      expect(request.url.startsWith(`${POSTHOG_EU_HOST}/`)).toBe(true)
      expect(request.body).not.toContain(CPF)
      expect(request.body).not.toContain('maria@example.com')
    }
    const sent = requests.map((request) => request.body).join('\n')
    expect(sent).toContain('$exception')
    expect(sent).toContain(TRACE_ID)
    expect(sent).toContain('[EMAIL]')
    expect(sent).toContain('teko@abc1234')
  })
})
