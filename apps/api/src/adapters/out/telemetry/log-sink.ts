import { isValidSpanId, isValidTraceId, ROOT_CONTEXT, trace } from '@opentelemetry/api'
import { type AnyValueMap, type Logger, SeverityNumber } from '@opentelemetry/api-logs'

/**
 * Ponte do pino para o OTel: cada linha JSON que o pino escreve (já com o `redact` aplicado) vira
 * um log record OTLP, exportado ao Loki no flush por requisição. O stdout continua recebendo a
 * mesma linha (depuração imediata nos logs de runtime da Vercel, que duram 1 h).
 *
 * - `level` do pino → `severityNumber` e `severityText` (o `level` do Loki);
 * - `msg` → corpo; `time` → timestamp;
 * - `trace_id`/`span_id` (do `mixin` do logger) → contexto do record, que o Grafana usa para ligar
 *   o log ao trace;
 * - o resto (`env`, `service`, `version`, `reqId`, `req`, `res`, `err`...) → atributos.
 */
export interface LogSink {
  write(line: string): void
}

const PINO_SEVERITY: Readonly<Record<number, readonly [SeverityNumber, string]>> = {
  10: [SeverityNumber.TRACE, 'trace'],
  20: [SeverityNumber.DEBUG, 'debug'],
  30: [SeverityNumber.INFO, 'info'],
  40: [SeverityNumber.WARN, 'warn'],
  50: [SeverityNumber.ERROR, 'error'],
  60: [SeverityNumber.FATAL, 'fatal'],
}

const UNMAPPED_KEYS: ReadonlySet<string> = new Set([
  'level',
  'time',
  'msg',
  'trace_id',
  'span_id',
  'trace_flags',
])

function severityOf(level: unknown): readonly [SeverityNumber, string] {
  return (
    (typeof level === 'number' ? PINO_SEVERITY[level] : undefined) ?? [
      SeverityNumber.UNSPECIFIED,
      'unknown',
    ]
  )
}

function contextOf(record: Record<string, unknown>) {
  const { trace_id: traceId, span_id: spanId, trace_flags: flags } = record
  if (
    typeof traceId !== 'string' ||
    typeof spanId !== 'string' ||
    !isValidTraceId(traceId) ||
    !isValidSpanId(spanId)
  ) {
    return ROOT_CONTEXT
  }
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId,
    spanId,
    traceFlags: typeof flags === 'string' ? Number.parseInt(flags, 16) || 0 : 0,
    isRemote: false,
  })
}

function parseLine(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** Converte uma linha do pino num log record (exportado à parte, pelo processor do provider). */
export function emitPinoLine(logger: Logger, line: string): void {
  const record = parseLine(line)
  if (record === null) {
    return
  }
  const { level, time: isoTime, msg } = record
  const [severityNumber, severityText] = severityOf(level)
  const attributes: AnyValueMap = {}
  for (const [key, value] of Object.entries(record)) {
    if (!UNMAPPED_KEYS.has(key) && value !== undefined) {
      attributes[key] = value as AnyValueMap[string]
    }
  }
  const time = typeof isoTime === 'string' ? Date.parse(isoTime) : Number.NaN
  logger.emit({
    severityNumber,
    severityText,
    body: typeof msg === 'string' ? msg : '',
    attributes,
    context: contextOf(record),
    ...(Number.isNaN(time) ? {} : { timestamp: time }),
  })
}

export function createOtelLogSink(logger: Logger): LogSink {
  return {
    write(line) {
      emitPinoLine(logger, line)
    },
  }
}
