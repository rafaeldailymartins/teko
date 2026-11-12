import { describe, expect, it } from 'vitest'
import type {
  CoverageWatchRepository,
  MarkVerifiedCommand,
} from '../ports/watch-coverage-repository.ts'
import type { DiscoveredChange, DiscoveredReport } from '../ports/watch-report.ts'
import { GAP_REASON_MAX, gapsFromReport, markCoverage } from './mark-coverage.ts'

function report(partial: Partial<DiscoveredReport> = {}): DiscoveredReport {
  return {
    schemaVersion: 1,
    runDate: '2026-11-11',
    generatedAt: '2026-11-11T12:00:00.000Z',
    changes: [],
    errors: [],
    unverifiedFamilies: [],
    ...partial,
  }
}

function change(partial: Partial<DiscoveredChange>): DiscoveredChange {
  return {
    family: 'rcte',
    sourceUrl: 'https://appasp.economia.go.gov.br/Legislacao/arquivos/Decretos/D_10995.htm',
    effectiveFrom: '2026-11-10',
    versionLabel: 'Decreto nº 10.995',
    kind: 'act',
    pageId: 'rcte-decretos-do-ano',
    mode: 'live',
    status: 'new',
    ...partial,
  }
}

function recordingRepository(): CoverageWatchRepository & { commands: MarkVerifiedCommand[] } {
  const commands: MarkVerifiedCommand[] = []
  return {
    commands,
    async markVerified(command) {
      commands.push(command)
      return { verifiedRows: 6, gapRows: command.gaps.length }
    },
  }
}

describe('markCoverage', () => {
  it('sem mudança, só avança o verified_at para a data do run', async () => {
    const repository = recordingRepository()
    const result = await markCoverage(repository, { report: report() })
    expect(repository.commands).toEqual([
      { verifiedAt: '2026-11-11', excludeFamilies: [], gaps: [] },
    ])
    expect(result).toEqual({
      verifiedRows: 6,
      gapRows: 0,
      verifiedAt: '2026-11-11',
      gaps: [],
      excludedFamilies: [],
    })
  })

  it('com mudança, abre a lacuna na menor data de efeito da família', async () => {
    const repository = recordingRepository()
    const result = await markCoverage(repository, {
      report: report({
        changes: [
          change({ effectiveFrom: '2026-11-10' }),
          change({
            effectiveFrom: '2026-10-08',
            versionLabel: 'Decreto nº 10.991',
            status: 'pending',
          }),
          change({
            family: 'efd-icms-ipi',
            kind: 'document',
            versionLabel: null,
            sourceUrl: 'https://www.gov.br/sped/guia-3-2-5.pdf',
            effectiveFrom: '2026-11-11',
          }),
        ],
        unverifiedFamilies: ['tabelas-go'],
      }),
    })
    expect(result.gaps).toEqual([
      {
        family: 'efd-icms-ipi',
        from: '2026-11-11',
        reason:
          'Mudança detectada pelo source-watch em 2026-11-11: ' +
          'https://www.gov.br/sped/guia-3-2-5.pdf (desde 2026-11-11)',
      },
      {
        family: 'rcte',
        from: '2026-10-08',
        reason:
          'Mudança detectada pelo source-watch em 2026-11-11: ' +
          'Decreto nº 10.991 (desde 2026-10-08, ainda não consolidado); ' +
          'Decreto nº 10.995 (desde 2026-11-10)',
      },
    ])
    expect(repository.commands[0]?.excludeFamilies).toEqual(['tabelas-go'])
    expect(result.gapRows).toBe(2)
  })

  it('limita o gap_reason', () => {
    const changes = Array.from({ length: 40 }, (_, index) =>
      change({ versionLabel: `Decreto nº ${String(20_000 + index)}` }),
    )
    const [gap] = gapsFromReport(report({ changes }))
    expect(gap?.reason).toHaveLength(GAP_REASON_MAX)
    expect(gap?.reason.endsWith('…')).toBe(true)
  })

  it('não repete a mesma mudança no motivo', () => {
    const [gap] = gapsFromReport(report({ changes: [change({}), change({})] }))
    expect(gap?.reason).toBe(
      'Mudança detectada pelo source-watch em 2026-11-11: Decreto nº 10.995 (desde 2026-11-10)',
    )
  })
})
