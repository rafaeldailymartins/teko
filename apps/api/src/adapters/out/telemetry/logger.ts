import { type LevelWithSilent, type Logger, type LoggerOptions, pino } from 'pino'

/**
 * Logger raiz (pino, JSON em stdout). Na Vercel, os logs de runtime ficam só 1 h (sem drains no
 * Hobby); os logs duráveis vão por OTLP direto para o Loki do Grafana Cloud (F6).
 *
 * O `redact` remove credenciais e o texto livre das perguntas, mesmo que alguém logue o objeto
 * da requisição inteiro. Os serializers padrão do Fastify já não incluem headers; a redação é a
 * segunda barreira. Na F6 o `PiiRedactor` passa a sanear também mensagens livres.
 */
export const REDACTED = '[REDACTED]'

const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'headers["set-cookie"]',
  'question',
  '*.question',
] as const

export interface LoggerConfig {
  readonly level: LevelWithSilent
  readonly appEnv: string
  readonly version: string
  readonly gitSha: string
  /** Saída legível via `pino-pretty` (só em desenvolvimento; é devDependency). */
  readonly pretty: boolean
}

export function loggerOptions(config: LoggerConfig): LoggerOptions {
  const options: LoggerOptions = {
    level: config.level,
    base: {
      service: 'teko-api',
      env: config.appEnv,
      version: config.version,
      gitSha: config.gitSha,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: [...LOG_REDACT_PATHS], censor: REDACTED },
  }
  return config.pretty ? { ...options, transport: { target: 'pino-pretty' } } : options
}

export function createLogger(config: LoggerConfig): Logger {
  return pino(loggerOptions(config))
}
