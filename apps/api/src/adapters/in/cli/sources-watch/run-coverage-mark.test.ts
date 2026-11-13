import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  CoverageWatchRepository,
  MarkVerifiedCommand,
} from '#app/ports/watch-coverage-repository.ts'
import type { DiscoveredReport } from '#app/ports/watch-report.ts'
import { tempDir } from '../../../../../test/setup/temp-dir.ts'
import { parseDiscoveredReport } from './discovered-schema.ts'
import {
  COVERAGE_MARK_USAGE,
  resolveWatchDatabaseUrls,
  runCoverageMark,
  WatchEnvError,
} from './run-coverage-mark.ts'

const REPORT: DiscoveredReport = {
  schemaVersion: 1,
  runDate: '2026-11-11',
  generatedAt: '2026-11-11T12:00:00.000Z',
  changes: [
    {
      family: 'rcte',
      sourceUrl: 'https://appasp.economia.go.gov.br/Legislacao/arquivos/Decretos/D_10995.htm',
      effectiveFrom: '2026-11-10',
      versionLabel: 'Decreto nº 10.995',
      kind: 'act',
      pageId: 'rcte-decretos-do-ano',
      mode: 'live',
      status: 'new',
    },
  ],
  errors: [{ pageId: 'sped-tabelas-go', family: 'tabelas-go', message: 'HTTP 503' }],
  unverifiedFamilies: ['tabelas-go'],
}

async function writeReport(content: string): Promise<string> {
  const dir = tempDir('teko-coverage-mark-')
  const file = join(dir, 'discovered.json')
  await writeFile(file, content)
  return file
}

function repository(fail = false): CoverageWatchRepository & { commands: MarkVerifiedCommand[] } {
  const commands: MarkVerifiedCommand[] = []
  return {
    commands,
    async markVerified(command) {
      if (fail) {
        throw new Error('conexão recusada')
      }
      commands.push(command)
      return { verifiedRows: 5, gapRows: command.gaps.length }
    },
  }
}

describe('runCoverageMark', () => {
  it('marca os dois bancos com o mesmo relatório', async () => {
    const file = await writeReport(JSON.stringify(REPORT))
    const prod = repository()
    const staging = repository()
    const lines: string[] = []
    const code = await runCoverageMark(
      {
        targets: [
          { name: 'teko-prod', repository: prod },
          { name: 'teko-staging', repository: staging },
        ],
        log: (line) => lines.push(line),
      },
      ['--discovered', file],
    )
    expect(code).toBe(0)
    expect(prod.commands).toEqual(staging.commands)
    expect(prod.commands[0]).toMatchObject({
      verifiedAt: '2026-11-11',
      excludeFamilies: ['tabelas-go'],
      gaps: [{ family: 'rcte', from: '2026-11-10' }],
    })
    expect(lines[0]).toBe(
      'teko-prod: verified_at=2026-11-11 em 5 família(s), 1 lacuna(s); sem avanço: tabelas-go',
    )
    expect(lines[1]).toMatch(/^ {2}lacuna rcte desde 2026-11-10: /)
  })

  it('segue para o outro banco quando um falha e devolve 1', async () => {
    const file = await writeReport(
      JSON.stringify({ ...REPORT, changes: [], errors: [], unverifiedFamilies: [] }),
    )
    const staging = repository()
    const lines: string[] = []
    const code = await runCoverageMark(
      {
        targets: [
          { name: 'teko-prod', repository: repository(true) },
          { name: 'teko-staging', repository: staging },
        ],
        log: (line) => lines.push(line),
      },
      ['--discovered', file],
    )
    expect(code).toBe(1)
    expect(lines).toEqual([
      'teko-prod: erro: conexão recusada',
      'teko-staging: verified_at=2026-11-11 em 5 família(s), 0 lacuna(s)',
    ])
    expect(staging.commands).toHaveLength(1)
  })

  function failing(error: unknown): CoverageWatchRepository {
    return {
      markVerified() {
        return Promise.reject(error)
      },
    }
  }

  function pgError(message: string, code: string): Error {
    return Object.assign(new Error(message), { code })
  }

  it('avisa sem reprovar quando o banco ainda não tem o schema corpus', async () => {
    const file = await writeReport(
      JSON.stringify({ ...REPORT, changes: [], errors: [], unverifiedFamilies: [] }),
    )
    const lines: string[] = []
    const wrapped = new Error('Failed query: update "corpus"."coverage" set …', {
      cause: pgError('relation "corpus.coverage" does not exist', '42P01'),
    })
    const code = await runCoverageMark(
      {
        targets: [
          { name: 'teko-prod', repository: failing(wrapped) },
          { name: 'teko-staging', repository: repository() },
        ],
        log: (line) => lines.push(line),
      },
      ['--discovered', file],
    )
    expect(code).toBe(0)
    expect(lines).toEqual([
      '::warning title=coverage-mark::teko-prod: sem o schema corpus (banco ainda não migrado), nada a marcar',
      'teko-staging: verified_at=2026-11-11 em 5 família(s), 0 lacuna(s)',
    ])
    expect(
      await runCoverageMark(
        {
          targets: [{ name: 'teko-prod', repository: failing(pgError('x', '3F000')) }],
          log: () => {},
        },
        ['--discovered', file],
      ),
    ).toBe(0)
  })

  it('mostra a causa do erro do pg embrulhado pelo Drizzle', async () => {
    const file = await writeReport(
      JSON.stringify({ ...REPORT, changes: [], errors: [], unverifiedFamilies: [] }),
    )
    const lines: string[] = []
    const wrapped = new Error('Failed query: update "corpus"."coverage"', {
      cause: pgError('permission denied for table coverage', '42501'),
    })
    const code = await runCoverageMark(
      {
        targets: [{ name: 'teko-prod', repository: failing(wrapped) }],
        log: (line) => lines.push(line),
      },
      ['--discovered', file],
    )
    expect(code).toBe(1)
    expect(lines).toEqual([
      'teko-prod: erro: Failed query: update "corpus"."coverage" ← causa: permission denied for table coverage [42501]',
    ])
  })

  it('descreve erros que não são Error nem trazem SQLSTATE textual', async () => {
    const file = await writeReport(
      JSON.stringify({ ...REPORT, changes: [], errors: [], unverifiedFamilies: [] }),
    )
    const lines: string[] = []
    const code = await runCoverageMark(
      {
        targets: [
          { name: 'teko-prod', repository: failing('boom') },
          {
            name: 'teko-staging',
            repository: failing(pgError('timeout', 42 as unknown as string)),
          },
          { name: 'teko-ci', repository: failing(null) },
        ],
        log: (line) => lines.push(line),
      },
      ['--discovered', file],
    )
    expect(code).toBe(1)
    expect(lines).toEqual([
      'teko-prod: erro: boom',
      'teko-staging: erro: timeout',
      'teko-ci: erro: ',
    ])
  })

  it('recusa argumentos inválidos e arquivo ausente ou inválido', async () => {
    const lines: string[] = []
    const deps = { targets: [], log: (line: string) => lines.push(line) }
    expect(await runCoverageMark(deps, [])).toBe(64)
    expect(await runCoverageMark(deps, ['--x'])).toBe(64)
    expect(lines).toContain(COVERAGE_MARK_USAGE)
    expect(await runCoverageMark(deps, ['--discovered', join(tmpdir(), 'nao-existe.json')])).toBe(1)
    const bad = await writeReport('{"schemaVersion": 2}')
    expect(await runCoverageMark(deps, ['--discovered', bad])).toBe(1)
    expect(lines.at(-1)).toMatch(/^erro: discovered.json inválido/)
  })

  it('usa o stdout sem log injetado', async () => {
    const file = await writeReport(JSON.stringify(REPORT))
    expect(await runCoverageMark({ targets: [] }, ['--discovered', file])).toBe(0)
  })
})

describe('parseDiscoveredReport', () => {
  it('aceita o relatório do sources-watch', () => {
    expect(parseDiscoveredReport(JSON.stringify(REPORT))).toEqual(REPORT)
  })

  it.each([
    ['JSON inválido', '{', /não é JSON válido/],
    [
      'família desconhecida',
      JSON.stringify({ ...REPORT, unverifiedFamilies: ['nfe'] }),
      /família desconhecida/,
    ],
    [
      'data inválida',
      JSON.stringify({ ...REPORT, runDate: '2026-02-30' }),
      /runDate: data ISO inválida/,
    ],
    [
      'URL que não é http(s)',
      JSON.stringify({
        ...REPORT,
        changes: [{ ...REPORT.changes[0], sourceUrl: 'javascript:alert(1)' }],
      }),
      /sourceUrl/,
    ],
  ])('recusa %s', (_name, text, message) => {
    expect(() => parseDiscoveredReport(text)).toThrow(message)
  })
})

describe('resolveWatchDatabaseUrls', () => {
  it('exige as duas URLs do teko_watch', () => {
    expect(() => resolveWatchDatabaseUrls({})).toThrow(
      'coverage-mark exige NEON_PROD_WATCH_URL e NEON_STAGING_WATCH_URL (role teko_watch, environment corpus-watch)',
    )
    expect(() =>
      resolveWatchDatabaseUrls({
        NEON_PROD_WATCH_URL: 'postgresql://p',
        NEON_STAGING_WATCH_URL: ' ',
      }),
    ).toThrow(/exige NEON_STAGING_WATCH_URL/)
    expect(() =>
      resolveWatchDatabaseUrls({
        NEON_PROD_WATCH_URL: 'psql x',
        NEON_STAGING_WATCH_URL: 'postgres://s',
      }),
    ).toThrow(WatchEnvError)
  })

  it('devolve as URLs na ordem prod, staging', () => {
    expect(
      resolveWatchDatabaseUrls({
        NEON_PROD_WATCH_URL: ' postgresql://prod ',
        NEON_STAGING_WATCH_URL: 'postgres://staging',
      }),
    ).toEqual([
      { name: 'teko-prod', url: 'postgresql://prod' },
      { name: 'teko-staging', url: 'postgres://staging' },
    ])
  })
})
