import type { Span } from '@opentelemetry/api'
import type pg from 'pg'
import { hasRecordingSpan, markFailed, startClientSpan } from '../../telemetry/tracing.ts'

/**
 * Spans das consultas do `pg`, criados à mão (o bundle não garante o hook de módulo da
 * `@opentelemetry/instrumentation-pg`). Cada cliente novo do pool tem o `query` embrulhado: as
 * consultas do Drizzle (promise) e as do próprio pool (callback) passam por ele.
 *
 * Só há span com um span ativo gravando (uma requisição amostrada): consultas fora de requisição
 * (CLI, manutenção) não abrem traces soltos. O texto vai truncado e sem valores: as consultas são
 * parametrizadas, e os parâmetros nunca entram no span.
 */
const MAX_QUERY_TEXT_LENGTH = 1000

type QueryFn = (...args: unknown[]) => unknown

function queryTextOf(config: unknown): string | null {
  if (typeof config === 'string') {
    return config
  }
  if (typeof config === 'object' && config !== null && 'text' in config) {
    return typeof config.text === 'string' ? config.text : null
  }
  return null
}

/** Primeira palavra da instrução (`SELECT`, `INSERT`, `WITH`...), o `db.operation.name`. */
export function operationOf(text: string | null): string {
  const match = text === null ? null : /^\s*([A-Za-z]+)/.exec(text)
  return match?.[1]?.toUpperCase() ?? 'QUERY'
}

function startQuerySpan(text: string | null): Span {
  const operation = operationOf(text)
  return startClientSpan(`pg ${operation}`, {
    'db.system.name': 'postgresql',
    'db.operation.name': operation,
    ...(text === null ? {} : { 'db.query.text': text.slice(0, MAX_QUERY_TEXT_LENGTH) }),
  })
}

function finish(span: Span, error: unknown): void {
  if (error !== null && error !== undefined) {
    markFailed(span, error)
  }
  span.end()
}

function isPromise(value: unknown): value is Promise<unknown> {
  return value instanceof Promise
}

/** Embrulha o `query` de um cliente do pool (idempotente por cliente). */
export function traceClientQueries(client: pg.ClientBase): void {
  const target = client as unknown as { query: QueryFn; __tekoTraced?: true }
  if (target.__tekoTraced === true) {
    return
  }
  const original = target.query
  target.__tekoTraced = true
  target.query = function tracedQuery(this: unknown, ...args: unknown[]): unknown {
    if (!hasRecordingSpan()) {
      return original.apply(this, args)
    }
    const span = startQuerySpan(queryTextOf(args[0]))
    const callback = args.at(-1)
    if (typeof callback === 'function') {
      args[args.length - 1] = (error: unknown, result: unknown) => {
        finish(span, error)
        return (callback as (error: unknown, result: unknown) => unknown)(error, result)
      }
      return original.apply(this, args)
    }
    let result: unknown
    try {
      result = original.apply(this, args)
    } catch (error) {
      finish(span, error)
      throw error
    }
    if (isPromise(result)) {
      result.then(
        () => finish(span, null),
        (error: unknown) => finish(span, error),
      )
    } else {
      // Submittable (cursor, stream): a consulta segue fora do span.
      finish(span, null)
    }
    return result
  }
}

/** Liga o embrulho em todo cliente novo do pool. */
export function tracePoolQueries(pool: pg.Pool): void {
  pool.on('connect', (client) => {
    traceClientQueries(client)
  })
}
