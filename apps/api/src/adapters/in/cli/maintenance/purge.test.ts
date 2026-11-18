import { describe, expect, it } from 'vitest'
import { parsePurgeArgs, runPurge } from './purge.ts'

const COUNTS = {
  questions: 3,
  expiredPending: 1,
  answerCache: 2,
  rateLimits: 5,
  sessions: 4,
  verifications: 0,
}

function pgError(code: string): Error {
  return Object.assign(new Error('relation "app.questions" does not exist'), { code })
}

function io() {
  const printed: string[] = []
  const warned: string[] = []
  return {
    printed,
    warned,
    print: (line: string) => printed.push(line),
    warn: (line: string) => warned.push(line),
  }
}

describe('parsePurgeArgs', () => {
  it('sem opção, schema ausente é falha; com a opção, aviso', () => {
    expect(parsePurgeArgs([])).toEqual({ allowMissingSchema: false })
    expect(parsePurgeArgs(['--allow-missing-schema'])).toEqual({ allowMissingSchema: true })
  })

  it('recusa opção desconhecida e argumento posicional', () => {
    expect(() => parsePurgeArgs(['--force'])).toThrow()
    expect(() => parsePurgeArgs(['staging'])).toThrow()
  })
})

describe('runPurge', () => {
  it('imprime as contagens em uma linha JSON', async () => {
    const out = io()
    await expect(runPurge(async () => COUNTS, { allowMissingSchema: false }, out)).resolves.toBe(0)
    expect(out.printed).toEqual([JSON.stringify(COUNTS)])
  })

  it.each(['42P01', '3F000'])(
    'com --allow-missing-schema, o SQLSTATE %s vira aviso e saída 0',
    async (code) => {
      const out = io()
      const failing = async () => {
        throw new Error('Failed query', { cause: pgError(code) })
      }
      await expect(runPurge(failing, { allowMissingSchema: true }, out)).resolves.toBe(0)
      expect(out.printed).toEqual(['{"skipped":"schema_missing"}'])
      expect(out.warned[0]).toContain('schema ausente')
    },
  )

  it('sem a opção, schema ausente continua sendo falha', async () => {
    const failing = async () => {
      throw pgError('42P01')
    }
    await expect(runPurge(failing, { allowMissingSchema: false }, io())).rejects.toThrow(
      'does not exist',
    )
  })

  it('outro erro (ex.: permissão) é falha mesmo com a opção', async () => {
    const failing = async () => {
      throw pgError('42501')
    }
    await expect(runPurge(failing, { allowMissingSchema: true }, io())).rejects.toThrow()
  })
})
