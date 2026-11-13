import type { IsoDate } from '@teko/shared/vigencia'
import type { Family } from '#domain/corpus/family.ts'
import type { CorpusIngestionRepository } from '../ports/corpus-ingestion-repository.ts'

/**
 * `RefreshCoverage` (fim do run de ingestão): para cada família atualizada, `covered` passa a ser a
 * união dos `valid_during` das redações publicáveis atuais (`auto`/`approved`, conhecimento aberto),
 * `verified_at` vira a data do run e saem as lacunas que o run resolveu: só a entrada cujo
 * documento ganhou, no run, uma versão criada depois da detecção (`clearResolvedGaps`); `gaps` e
 * `gap_reason` são regravados com o que sobrou. Um `corpus_versions` novo é gravado por último e carimba os chunks do
 * run. Sem `families`, recalcula as famílias que tiveram versão publicada no run; se não houver
 * nenhuma, não grava nada e devolve a versão atual.
 */

interface RefreshCoverageCommand {
  readonly runId: string
  readonly verifiedAt: IsoDate
  readonly families?: readonly Family[]
}

export type RefreshCoverage = (
  command: RefreshCoverageCommand,
) => Promise<{ readonly corpusVersion: number }>

export function createRefreshCoverage(deps: {
  readonly repository: CorpusIngestionRepository
}): RefreshCoverage {
  return ({ runId, verifiedAt, families }) =>
    deps.repository.refreshCoverage({
      runId,
      verifiedAt,
      families,
      notes: `ingestão ${runId}`,
    })
}
