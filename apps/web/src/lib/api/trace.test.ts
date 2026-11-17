import { describe, expect, it, vi } from 'vitest'
import {
  createTraceparent,
  TRACE_ID_HEADER,
  TRACEPARENT_HEADER,
  traceIdOf,
  withTraceparent,
} from './trace.ts'

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-00$/

describe('createTraceparent', () => {
  it('gera um traceparent W3C versão 00, com a flag sampled desligada', () => {
    expect(createTraceparent()).toMatch(TRACEPARENT)
  })

  it('cada chamada tem um trace_id novo', () => {
    const ids = new Set(
      Array.from({ length: 20 }, () => TRACEPARENT.exec(createTraceparent())?.[1]),
    )
    expect(ids.size).toBe(20)
  })

  it('nunca usa um id todo zero (inválido no W3C)', () => {
    const real = crypto.getRandomValues.bind(crypto)
    let calls = 0
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      calls += 1
      // A primeira tentativa de cada id volta zerada.
      return calls === 1 || calls === 3 ? array : real(array)
    })
    const [, traceId, parentId] = TRACEPARENT.exec(createTraceparent()) ?? []
    spy.mockRestore()
    expect(traceId).not.toMatch(/^0+$/)
    expect(parentId).not.toMatch(/^0+$/)
    expect(calls).toBe(4)
  })
})

describe('withTraceparent', () => {
  it('acrescenta o header e preserva um que já exista', () => {
    const fresh = withTraceparent(new Headers({ 'content-type': 'application/json' }))
    expect(fresh.get(TRACEPARENT_HEADER)).toMatch(TRACEPARENT)
    expect(fresh.get('content-type')).toBe('application/json')
    const given = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`
    expect(withTraceparent(new Headers({ traceparent: given })).get(TRACEPARENT_HEADER)).toBe(given)
  })
})

describe('traceIdOf', () => {
  const withHeader = (value: string) =>
    new Response(null, { headers: { [TRACE_ID_HEADER]: value } })

  it('lê o x-trace-id em 32 hex, normalizado', () => {
    expect(traceIdOf(withHeader(` ${'A'.repeat(32)} `))).toBe('a'.repeat(32))
  })

  it.each(['abc', 'g'.repeat(32), ''])('ignora valor fora do formato (%s)', (value) => {
    expect(traceIdOf(withHeader(value))).toBeNull()
  })

  it('sem resposta ou sem header, null', () => {
    expect(traceIdOf(undefined)).toBeNull()
    expect(traceIdOf(new Response(null))).toBeNull()
  })
})
