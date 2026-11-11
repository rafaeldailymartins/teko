import { describe, expect, it } from 'vitest'
import { createDatabase } from './client.ts'

describe('createDatabase', () => {
  it('cria o pool sem conectar, com os padrões, e fecha uma vez só', async () => {
    const database = createDatabase({
      url: 'postgresql://u:p@127.0.0.1:1/teko',
      applicationName: 'teko-test',
    })
    expect(database.pool.options).toMatchObject({
      max: 5,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 10_000,
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
