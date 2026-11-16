import { Writable } from 'node:stream'
import { context, ROOT_CONTEXT, TraceFlags, trace } from '@opentelemetry/api'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLogger, type LoggerConfig, loggerOptions, REDACTED, traceFields } from './logger.ts'
import { type InMemoryTracing, registerInMemoryTracing } from './testing/in-memory-tracing.ts'

let tracing: InMemoryTracing

beforeAll(() => {
  // Registra o contexto assíncrono (o `context.with` abaixo precisa dele).
  tracing = registerInMemoryTracing()
})

afterAll(async () => {
  await tracing.stop()
})

const CONFIG: LoggerConfig = {
  level: 'info',
  appEnv: 'staging',
  version: '0.1.0',
  gitSha: 'abc1234',
  pretty: false,
}

function capture(config: LoggerConfig): {
  logger: pino.Logger
  lines: () => Record<string, unknown>[]
} {
  const chunks: string[] = []
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString('utf8'))
      callback()
    },
  })
  return {
    logger: pino(loggerOptions(config), destination),
    lines: () => chunks.map((line) => JSON.parse(line) as Record<string, unknown>),
  }
}

describe('logger', () => {
  it('inclui serviço, ambiente, versão e SHA em toda linha', () => {
    const { logger, lines } = capture(CONFIG)
    logger.info('hello')
    expect(lines()[0]).toMatchObject({
      service: 'teko-api',
      env: 'staging',
      version: '0.1.0',
      gitSha: 'abc1234',
      msg: 'hello',
    })
    expect(lines()[0]).toMatchObject({ time: expect.any(String) })
  })

  it('redige credenciais e o texto da pergunta', () => {
    const { logger, lines } = capture(CONFIG)
    logger.info(
      {
        req: {
          headers: {
            authorization: 'Bearer t',
            cookie: 'sid=1',
            accept: '*/*',
          },
        },
        res: { headers: { 'set-cookie': 'sid=2' } },
        body: { question: 'Meu CPF é 123.456.789-09' },
        question: 'texto livre',
      },
      'request',
    )
    expect(lines()[0]).toMatchObject({
      req: {
        headers: {
          authorization: REDACTED,
          cookie: REDACTED,
          accept: '*/*',
        },
      },
      res: { headers: { 'set-cookie': REDACTED } },
      body: { question: REDACTED },
      question: REDACTED,
    })
    expect(JSON.stringify(lines())).not.toMatch(/Bearer|sid=|CPF|texto livre/)
  })

  it('só usa pino-pretty quando pedido', () => {
    expect(loggerOptions(CONFIG).transport).toBeUndefined()
    expect(loggerOptions({ ...CONFIG, pretty: true }).transport).toEqual({ target: 'pino-pretty' })
  })

  it('createLogger respeita o nível configurado', () => {
    const logger = createLogger({ ...CONFIG, level: 'warn' })
    expect(logger.level).toBe('warn')
    expect(logger.isLevelEnabled('info')).toBe(false)
  })
})

describe('logger e telemetria', () => {
  it('dentro de um span, a linha leva trace_id, span_id e trace_flags', () => {
    const { logger, lines } = capture(CONFIG)
    const spanContext = {
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: TraceFlags.SAMPLED,
    }
    context.with(trace.setSpanContext(ROOT_CONTEXT, spanContext), () => {
      logger.info('dentro')
    })
    logger.info('fora')
    expect(lines()[0]).toMatchObject({
      trace_id: spanContext.traceId,
      span_id: spanContext.spanId,
      trace_flags: '01',
    })
    expect(lines()[1]).not.toHaveProperty('trace_id')
  })

  it('traceFields fica vazio sem span válido', () => {
    expect(traceFields()).toEqual({})
  })

  it('com LogSink, a mesma linha (já redigida) vai também ao OTel', () => {
    const written: string[] = []
    const logger = createLogger({ ...CONFIG, sink: { write: (line) => written.push(line) } })
    logger.warn({ question: 'segredo' }, 'aviso')
    expect(written).toHaveLength(1)
    expect(JSON.parse(written[0] ?? '{}')).toMatchObject({
      level: 40,
      msg: 'aviso',
      question: REDACTED,
    })
  })

  it('o nível do logger filtra também o LogSink', () => {
    const written: string[] = []
    const logger = createLogger({
      ...CONFIG,
      level: 'warn',
      sink: { write: (line) => written.push(line) },
    })
    logger.info('não vai')
    expect(written).toHaveLength(0)
  })
})
