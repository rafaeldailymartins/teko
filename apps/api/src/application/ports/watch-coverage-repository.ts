import type { IsoDate } from '@teko/shared/vigencia'

/**
 * Escrita do `mark-coverage` em `corpus.coverage`, com o role `teko_watch` (que só pode ler a
 * tabela e atualizar `verified_at`, `gaps` e `gap_reason`).
 */

export interface FamilyGap {
  readonly family: string
  /** A lacuna acrescentada é `[from, ∞)`. */
  readonly from: IsoDate
  readonly reason: string
}

export interface MarkVerifiedCommand {
  /** Data do run (`America/Sao_Paulo`). */
  readonly verifiedAt: IsoDate
  /** Famílias cuja verificação falhou neste run: o `verified_at` delas não avança. */
  readonly excludeFamilies: readonly string[]
  /** Lacunas das famílias com mudança detectada. */
  readonly gaps: readonly FamilyGap[]
}

export interface MarkVerifiedResult {
  /** Linhas com `verified_at` avançado. */
  readonly verifiedRows: number
  /** Linhas com lacuna acrescentada. */
  readonly gapRows: number
}

export interface CoverageWatchRepository {
  /**
   * Sem lacunas e sem exclusões, executa exatamente um
   * `UPDATE corpus.coverage SET verified_at = $1 WHERE verified_at < $1`. Com lacunas, acrescenta
   * `[from, ∞)` a `gaps` e grava `gap_reason` de cada família na mesma transação.
   */
  markVerified(command: MarkVerifiedCommand): Promise<MarkVerifiedResult>
}
