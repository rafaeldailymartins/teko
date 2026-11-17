import { trace } from '@opentelemetry/api'
import type { Logger, LogRecord } from '@opentelemetry/api-logs'
import { SeverityNumber } from '@opentelemetry/api-logs'
import { describe, expect, it } from 'vitest'
import { createOtelLogSink, emitPinoLine } from './log-sink.ts'

function capture(): { logger: Logger; records: LogRecord[] } {
  const records: LogRecord[] = []
  return {
    records,
    logger: {
      enabled: () => true,
      emit: (record) => {
        records.push(record)
      },
    },
  }
}

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const SPAN_ID = '00f067aa0ba902b7'

describe('emitPinoLine', () => {
  it('nível, corpo, horário, atributos e o contexto do trace', () => {
    const { logger, records } = capture()
    emitPinoLine(
      logger,
      JSON.stringify({
        level: 50,
        time: '2026-11-10T15:00:00.000Z',
        msg: 'request failed',
        service: 'teko-api',
        env: 'staging',
        reqId: 'r1',
        err: { type: 'Error' },
        trace_id: TRACE_ID,
        span_id: SPAN_ID,
        trace_flags: '01',
      }),
    )
    const [record] = records
    expect(record).toMatchObject({
      severityNumber: SeverityNumber.ERROR,
      severityText: 'error',
      body: 'request failed',
      timestamp: Date.parse('2026-11-10T15:00:00.000Z'),
      attributes: { service: 'teko-api', env: 'staging', reqId: 'r1', err: { type: 'Error' } },
    })
    expect(record?.attributes).not.toHaveProperty('trace_id')
    expect(record?.attributes).not.toHaveProperty('level')
    const spanContext = trace.getSpanContext(record?.context as never)
    expect(spanContext).toMatchObject({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1 })
  })

  it.each([
    [10, SeverityNumber.TRACE, 'trace'],
    [20, SeverityNumber.DEBUG, 'debug'],
    [30, SeverityNumber.INFO, 'info'],
    [40, SeverityNumber.WARN, 'warn'],
    [60, SeverityNumber.FATAL, 'fatal'],
    [35, SeverityNumber.UNSPECIFIED, 'unknown'],
  ])('nível %d → %d (%s)', (level, severityNumber, severityText) => {
    const { logger, records } = capture()
    emitPinoLine(logger, JSON.stringify({ level, msg: 'x' }))
    expect(records[0]).toMatchObject({ severityNumber, severityText })
  })

  it('sem trace, sem msg e sem horário válido: contexto raiz, corpo vazio, sem timestamp', () => {
    const { logger, records } = capture()
    emitPinoLine(
      logger,
      JSON.stringify({ level: 30, time: 'ontem', trace_id: 'x', span_id: SPAN_ID, n: 1 }),
    )
    expect(records[0]).toMatchObject({ body: '', attributes: { n: 1 } })
    expect(records[0]).not.toHaveProperty('timestamp')
    expect(trace.getSpanContext(records[0]?.context as never)).toBeUndefined()
  })

  it('trace_flags ausente vira 0', () => {
    const { logger, records } = capture()
    emitPinoLine(logger, JSON.stringify({ level: 30, trace_id: TRACE_ID, span_id: SPAN_ID }))
    expect(trace.getSpanContext(records[0]?.context as never)?.traceFlags).toBe(0)
  })

  it.each(['não é json', '[1,2]', 'null', '42'])('ignora linha que não é objeto (%s)', (line) => {
    const { logger, records } = capture()
    emitPinoLine(logger, line)
    expect(records).toHaveLength(0)
  })

  it('createOtelLogSink escreve pelo logger', () => {
    const { logger, records } = capture()
    createOtelLogSink(logger).write(JSON.stringify({ level: 30, msg: 'oi' }))
    expect(records.map((record) => record.body)).toEqual(['oi'])
  })
})
