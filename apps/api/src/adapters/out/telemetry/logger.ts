import { context, isSpanContextValid, trace } from '@opentelemetry/api'
import { type LevelWithSilent, type Logger, type LoggerOptions, pino } from 'pino'
import type { LogSink } from './log-sink.ts'

/**
 * Logger raiz (pino, JSON em stdout). Na Vercel, os logs de runtime ficam só 1 h (sem drains no
 * Hobby); os logs duráveis vão por OTLP direto para o Loki do Grafana Cloud: com telemetria
 * ligada, cada linha também vai ao `LogSink` do OTel (`log-sink.ts`), já redigida.
 *
 * Toda linha escrita dentro de uma requisição leva `trace_id`, `span_id` e `trace_flags` do span
 * ativo (o `mixin`), no stdout e no Loki, para ligar o log ao trace.
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
  /** Saída legível via `pino-pretty` (só em desenvolvimento; é devDependency). Sem `LogSink`. */
  readonly pretty: boolean
  /** Destino OTel dos logs (`null`/ausente: só stdout). */
  readonly sink?: LogSink | null
}

/** Campos de correlação do span ativo (vazio fora de um span válido). */
export function traceFields(): Record<string, string> {
  const span = trace.getSpan(context.active())
  const spanContext = span?.spanContext()
  if (spanContext === undefined || !isSpanContextValid(spanContext)) {
    return {}
  }
  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
    trace_flags: spanContext.traceFlags.toString(16).padStart(2, '0'),
  }
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
    mixin: traceFields,
  }
  return config.pretty ? { ...options, transport: { target: 'pino-pretty' } } : options
}

export function createLogger(config: LoggerConfig): Logger {
  const options = loggerOptions(config)
  if (config.pretty || config.sink === undefined || config.sink === null) {
    return pino(options)
  }
  // `trace` nos dois destinos: quem filtra é o `level` do logger.
  return pino(
    options,
    pino.multistream([
      { level: 'trace', stream: pino.destination({ dest: 1, sync: true }) },
      { level: 'trace', stream: config.sink },
    ]),
  )
}
