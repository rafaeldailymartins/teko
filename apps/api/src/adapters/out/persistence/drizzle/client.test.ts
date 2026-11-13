import { describe, expect, it, vi } from 'vitest'
import {
  createDatabase,
  DEFAULT_MAX_CONNECTIONS,
  isTransientConnectionError,
  retryTransientRead,
} from './client.ts'

function withCode(code: string, message = 'erro do pg'): Error {
  return Object.assign(new Error(message), { code })
}

describe('createDatabase', () => {
  it('cria o pool sem conectar, com os padrões do plano, e fecha uma vez só', async () => {
    const database = createDatabase({
      url: 'postgresql://u:p@127.0.0.1:1/teko',
      applicationName: 'teko-test',
    })
    expect(DEFAULT_MAX_CONNECTIONS).toBe(3)
    expect(database.pool.options).toMatchObject({
      max: 3,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 8000,
      application_name: 'teko-test',
    })
    expect(database.pool.totalCount).toBe(0)
    expect(typeof database.db.select).toBe('function')
    // Erro de conexão ociosa não derruba o processo.
    expect(() => database.pool.emit('error', new Error('terminating connection'))).not.toThrow()
    const first = database.close()
    expect(database.close()).toBe(first)
    await first
  })

  it('aceita teto de conexões e ociosidade', async () => {
    const database = createDatabase({
      url: 'postgresql://u:p@127.0.0.1:1/teko',
      applicationName: 'teko-cli',
      maxConnections: 2,
      idleTimeoutMs: 100,
    })
    expect(database.pool.options).toMatchObject({ max: 2, idleTimeoutMillis: 100 })
    await database.close()
  })
})

describe('isTransientConnectionError', () => {
  it('reconhece 57P01 e ECONNRESET, inclusive no cause (erro embrulhado pelo Drizzle)', () => {
    expect(isTransientConnectionError(withCode('57P01'))).toBe(true)
    expect(isTransientConnectionError(withCode('ECONNRESET'))).toBe(true)
    const wrapped = new Error('Failed query', { cause: withCode('57P01') })
    expect(isTransientConnectionError(wrapped)).toBe(true)
  })

  it('não trata como transitório o resto (timeout de consulta, violação, valores sem code)', () => {
    expect(isTransientConnectionError(withCode('57014'))).toBe(false)
    expect(isTransientConnectionError(withCode('23505'))).toBe(false)
    expect(isTransientConnectionError(new Error('sem code'))).toBe(false)
    expect(isTransientConnectionError(Object.assign(new Error('x'), { code: 57 }))).toBe(false)
    expect(isTransientConnectionError({ code: '57P01' })).toBe(false)
    expect(isTransientConnectionError(undefined)).toBe(false)
  })

  it('para de seguir o cause depois de alguns níveis (ciclo não trava)', () => {
    const loop = new Error('a')
    Object.assign(loop, { cause: loop })
    expect(isTransientConnectionError(loop)).toBe(false)
  })
})

describe('retryTransientRead', () => {
  it('repete uma vez a leitura que caiu por erro de conexão transitório', async () => {
    const read = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        withCode('57P01', 'terminating connection due to administrator command'),
      )
      .mockResolvedValueOnce('linhas')
    await expect(retryTransientRead(read)).resolves.toBe('linhas')
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('não repete mais de uma vez', async () => {
    const read = vi.fn<() => Promise<string>>().mockRejectedValue(withCode('ECONNRESET'))
    await expect(retryTransientRead(read)).rejects.toMatchObject({ code: 'ECONNRESET' })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('outros erros propagam sem retry, e o sucesso não repete', async () => {
    const failing = vi.fn<() => Promise<string>>().mockRejectedValue(withCode('57014'))
    await expect(retryTransientRead(failing)).rejects.toMatchObject({ code: '57014' })
    expect(failing).toHaveBeenCalledOnce()
    const ok = vi.fn<() => Promise<number>>().mockResolvedValue(1)
    await expect(retryTransientRead(ok)).resolves.toBe(1)
    expect(ok).toHaveBeenCalledOnce()
  })
})
