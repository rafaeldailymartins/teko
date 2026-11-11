import { Writable } from 'node:stream'
import { pino } from 'pino'
import { describe, expect, it } from 'vitest'
import { createLogger, type LoggerConfig, loggerOptions, REDACTED } from './logger.ts'

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
            'x-nf-sign': 'jws',
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
          'x-nf-sign': REDACTED,
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
