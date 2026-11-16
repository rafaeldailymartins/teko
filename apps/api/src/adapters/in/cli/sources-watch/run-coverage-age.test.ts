import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  CoverageVerifiedReader,
  FamilyVerifiedAt,
} from '#app/ports/watch-coverage-repository.ts'
import { tempDir } from '../../../../../test/setup/temp-dir.ts'
import { COVERAGE_AGE_USAGE, type CoverageAgeReport, runCoverageAge } from './run-coverage-age.ts'

const NOW = new Date('2026-11-16T09:45:00.000Z')

function reader(families: readonly FamilyVerifiedAt[]): CoverageVerifiedReader {
  return { listVerifiedAt: () => Promise.resolve(families) }
}

function failing(error: unknown): CoverageVerifiedReader {
  return { listVerifiedAt: () => Promise.reject(error) }
}

async function run(
  targets: Parameters<typeof runCoverageAge>[0]['targets'],
  args?: readonly string[],
): Promise<{ code: number; lines: string[]; report: CoverageAgeReport | null }> {
  const out = join(tempDir('teko-coverage-age-'), 'sub', 'coverage-age.json')
  const lines: string[] = []
  const code = await runCoverageAge(
    { targets, now: () => NOW, log: (line) => lines.push(line) },
    args ?? ['--out', out],
  )
  let report: CoverageAgeReport | null = null
  if (args === undefined) {
    report = JSON.parse(await readFile(out, 'utf8')) as CoverageAgeReport
  }
  return { code, lines, report }
}

describe('runCoverageAge', () => {
  it('grava o verified_at de cada família dos dois bancos, com o ambiente', async () => {
    const { code, report, lines } = await run([
      { name: 'teko-prod', reader: reader([{ family: 'rcte', verifiedAt: '2026-11-16' }]) },
      {
        name: 'teko-staging',
        reader: reader([
          { family: 'cte', verifiedAt: '2026-11-15' },
          { family: 'rcte', verifiedAt: '2026-11-12' },
        ]),
      },
    ])
    expect(code).toBe(0)
    expect(report).toEqual({
      schemaVersion: 1,
      generatedAt: '2026-11-16T09:45:00.000Z',
      databases: [
        {
          name: 'teko-prod',
          environment: 'production',
          families: [{ family: 'rcte', verifiedAt: '2026-11-16' }],
        },
        {
          name: 'teko-staging',
          environment: 'staging',
          families: [
            { family: 'cte', verifiedAt: '2026-11-15' },
            { family: 'rcte', verifiedAt: '2026-11-12' },
          ],
        },
      ],
    })
    expect(lines).toEqual(['teko-prod: 1 família(s)', 'teko-staging: 2 família(s)'])
  })

  it('banco sem o schema corpus sai sem famílias, com aviso e sem reprovar', async () => {
    const missing = Object.assign(new Error('Failed query'), {
      cause: Object.assign(new Error('relation "corpus.coverage" does not exist'), {
        code: '42P01',
      }),
    })
    const { code, report, lines } = await run([
      { name: 'teko-prod', reader: failing(missing) },
      { name: 'teko-staging', reader: reader([]) },
    ])
    expect(code).toBe(0)
    expect(report?.databases[0]).toEqual({
      name: 'teko-prod',
      environment: 'production',
      families: [],
      missingSchema: true,
    })
    expect(lines[0]).toMatch(/^::warning title=coverage-age::teko-prod: sem o schema corpus/u)
  })

  it('erro de conexão grava o JSON com o erro e devolve 1', async () => {
    const { code, report } = await run([
      { name: 'teko-prod', reader: failing(new Error('conexão recusada')) },
      { name: 'teko-staging', reader: reader([{ family: 'cte', verifiedAt: '2026-11-15' }]) },
    ])
    expect(code).toBe(1)
    expect(report?.databases[0]?.error).toBe('conexão recusada')
    expect(report?.databases[1]?.families).toHaveLength(1)
  })

  it('sem --out (ou com argumento desconhecido) devolve 64 com o uso', async () => {
    const empty = await run([], [])
    expect(empty.code).toBe(64)
    expect(empty.lines).toEqual([COVERAGE_AGE_USAGE])
    const unknown = await run([], ['--saida', 'x'])
    expect(unknown.code).toBe(64)
    expect(unknown.lines[0]).toContain(COVERAGE_AGE_USAGE)
  })
})
