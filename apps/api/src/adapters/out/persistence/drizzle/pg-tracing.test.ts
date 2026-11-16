import { EventEmitter } from 'node:events'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type InMemoryTracing,
  registerInMemoryTracing,
} from '../../telemetry/testing/in-memory-tracing.ts'
import { operationOf, traceClientQueries, tracePoolQueries } from './pg-tracing.ts'

let tracing: InMemoryTracing

beforeAll(() => {
  tracing = registerInMemoryTracing()
})

afterAll(async () => {
  await tracing.stop()
})

beforeEach(() => {
  tracing.exporter.reset()
})

type Query = (...args: unknown[]) => unknown

function fakeClient(query: Query): pg.ClientBase {
  return { query } as unknown as pg.ClientBase
}

function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  return trace.getTracer('teste').startActiveSpan('request', async (span) => {
    try {
      return await fn()
    } finally {
      span.end()
    }
  })
}

const queriesOf = () => tracing.spans().filter((span) => span.name.startsWith('pg '))

describe('traceClientQueries', () => {
  it('consulta com promise vira span pg <operação> com o texto, sem os parâmetros', async () => {
    const client = fakeClient(async () => ({ rows: [] }))
    traceClientQueries(client)
    await inRequest(() =>
      client.query({ text: 'select * from app.questions where id = $1', values: ['segredo'] }),
    )
    const [span] = queriesOf()
    expect(span?.name).toBe('pg SELECT')
    expect(span?.attributes).toEqual({
      'db.system.name': 'postgresql',
      'db.operation.name': 'SELECT',
      'db.query.text': 'select * from app.questions where id = $1',
    })
    expect(JSON.stringify(span?.attributes)).not.toContain('segredo')
  })

  it('consulta com callback (a do pool) fecha o span no callback', async () => {
    const client = fakeClient((_text: unknown, _values: unknown, callback: unknown) => {
      setImmediate(() =>
        (callback as (error: unknown, result: unknown) => void)(null, { rows: [] }),
      )
    })
    traceClientQueries(client)
    const result = await inRequest(
      () =>
        new Promise((resolve) => {
          ;(client.query as unknown as Query)(
            'INSERT INTO t VALUES ($1)',
            [1],
            (_e: unknown, r: unknown) => resolve(r),
          )
        }),
    )
    expect(result).toEqual({ rows: [] })
    expect(queriesOf().map((span) => span.name)).toEqual(['pg INSERT'])
  })

  it('erro marca o span (promise, callback e exceção síncrona)', async () => {
    const rejecting = fakeClient(() => Promise.reject(new Error('23505')))
    traceClientQueries(rejecting)
    await inRequest(() => expect(rejecting.query('UPDATE t SET a = 1')).rejects.toThrow('23505'))

    const callbackError = fakeClient((_text: unknown, callback: unknown) => {
      ;(callback as (error: unknown) => void)(new Error('falhou'))
    })
    traceClientQueries(callbackError)
    await inRequest(async () => {
      ;(callbackError.query as unknown as Query)('DELETE FROM t', () => {})
    })

    const throwing = fakeClient(() => {
      throw new Error('sync')
    })
    traceClientQueries(throwing)
    await inRequest(async () => {
      expect(() => throwing.query('SELECT 1')).toThrow('sync')
    })
    expect(queriesOf().map((span) => span.status.code)).toEqual([
      SpanStatusCode.ERROR,
      SpanStatusCode.ERROR,
      SpanStatusCode.ERROR,
    ])
  })

  it('submittable (cursor) e consulta sem texto: span fechado na hora, operação QUERY', async () => {
    const submittable = { submit: () => {} }
    const client = fakeClient(() => submittable)
    traceClientQueries(client)
    await inRequest(async () => {
      expect((client.query as unknown as Query)(submittable)).toBe(submittable)
    })
    expect(queriesOf()[0]?.name).toBe('pg QUERY')
    expect(queriesOf()[0]?.attributes).not.toHaveProperty('db.query.text')
  })

  it('fora de uma requisição, nenhum span', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    const client = fakeClient(query)
    traceClientQueries(client)
    await client.query('SELECT 1')
    expect(query).toHaveBeenCalledWith('SELECT 1')
    expect(queriesOf()).toHaveLength(0)
  })

  it('embrulha uma vez só e trunca o texto longo', async () => {
    const client = fakeClient(async () => ({ rows: [] }))
    traceClientQueries(client)
    traceClientQueries(client)
    await inRequest(() => client.query(`SELECT ${'x'.repeat(5000)}`))
    expect(queriesOf()).toHaveLength(1)
    expect(String(queriesOf()[0]?.attributes['db.query.text'])).toHaveLength(1000)
  })
})

describe('tracePoolQueries', () => {
  it('embrulha cada cliente novo do pool', async () => {
    const pool = new EventEmitter() as unknown as pg.Pool
    tracePoolQueries(pool)
    const client = fakeClient(async () => ({ rows: [] }))
    ;(pool as unknown as EventEmitter).emit('connect', client)
    await inRequest(() => client.query('WITH x AS (SELECT 1) SELECT * FROM x'))
    expect(queriesOf().map((span) => span.name)).toEqual(['pg WITH'])
  })
})

describe('operationOf', () => {
  it.each([
    ['  select 1', 'SELECT'],
    ['', 'QUERY'],
    [null, 'QUERY'],
    ['(SELECT 1)', 'QUERY'],
  ])('%s → %s', (text, operation) => {
    expect(operationOf(text)).toBe(operation)
  })
})
