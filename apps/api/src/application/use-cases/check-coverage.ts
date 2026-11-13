import type { IsoDate } from '@teko/shared/vigencia'
import {
  type CoverageDecision,
  decideCoverage,
  type FamilyCoverageRecord,
} from '#domain/vigencia/coverage-decision.ts'
import type { Clock } from '../ports/clock.ts'
import type { CoverageRepository } from '../ports/coverage-repository.ts'

/**
 * `CheckCoverage`: decide se as famílias pedidas cobrem a data de referência. Uma data posterior ao
 * `verified_at` recusa sem chamar o LLM.
 *
 * A cobertura fica em memória da instância e é relida sob demanda, no máximo a cada 10 min (plano,
 * regras de CU-h, item 5): uma pergunta não acorda o Neon só para ler `corpus.coverage`. Uma
 * `corpus_version` nova (ingestão, promoção ou o `mark-coverage` diário) vem de outro processo, no
 * Actions; a instância a enxerga na primeira releitura depois do prazo. Chamadas simultâneas com o
 * cache vencido dividem a mesma leitura, e uma leitura que falhou não fica no cache.
 */
export type CheckCoverage = (
  date: IsoDate,
  families: readonly string[],
) => Promise<CoverageDecision>

/** Prazo do cache de cobertura (plano: 10 min). */
export const COVERAGE_CACHE_TTL_MS = 10 * 60 * 1000

interface CachedCoverage {
  readonly records: Promise<readonly FamilyCoverageRecord[]>
  readonly loadedAt: number
}

export function createCheckCoverage(deps: {
  readonly coverageRepository: CoverageRepository
  readonly clock: Clock
  /** Padrão: `COVERAGE_CACHE_TTL_MS`. */
  readonly ttlMs?: number
}): CheckCoverage {
  const ttlMs = deps.ttlMs ?? COVERAGE_CACHE_TTL_MS
  let cached: CachedCoverage | null = null

  function load(now: number): Promise<readonly FamilyCoverageRecord[]> {
    const records = deps.coverageRepository.loadCoverage()
    const entry: CachedCoverage = { records, loadedAt: now }
    cached = entry
    records.catch(() => {
      // Só esquece a leitura que falhou se nenhuma outra a substituiu nesse meio-tempo.
      if (cached === entry) {
        cached = null
      }
    })
    return records
  }

  return async (date, families) => {
    const now = deps.clock.now().getTime()
    const entry = cached
    // Relógio que voltou (`now < loadedAt`) também relê.
    const fresh = entry !== null && now >= entry.loadedAt && now - entry.loadedAt < ttlMs
    const records = fresh ? entry.records : load(now)
    return decideCoverage(date, families, await records)
  }
}
