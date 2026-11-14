import type { CoverageResponse } from '@teko/shared/contracts'
import type { IsoDate } from '@teko/shared/vigencia'
import {
  type CoverageDecision,
  decideCoverage,
  effectiveFamilyCoverage,
} from '#domain/vigencia/coverage-decision.ts'
import type { Clock } from '../ports/clock.ts'
import type { CoverageRepository, CoverageSnapshot } from '../ports/coverage-repository.ts'

/**
 * Cobertura em memória da instância, relida sob demanda no máximo a cada 10 min (plano, regras de
 * CU-h, item 5): nem uma pergunta nem o `GET /api/v1/coverage` acordam o Neon só para ler
 * `corpus.coverage`. Uma `corpus_version` nova (ingestão, promoção ou o `mark-coverage` diário) vem
 * de outro processo, no Actions; a instância a enxerga na primeira releitura depois do prazo.
 * Chamadas simultâneas com o cache vencido dividem a mesma leitura, e uma leitura que falhou não
 * fica no cache.
 */
export type CoverageSource = () => Promise<CoverageSnapshot>

/** Prazo do cache de cobertura (plano: 10 min). */
export const COVERAGE_CACHE_TTL_MS = 10 * 60 * 1000

interface CachedCoverage {
  readonly snapshot: Promise<CoverageSnapshot>
  readonly loadedAt: number
}

export function createCoverageSource(deps: {
  readonly coverageRepository: CoverageRepository
  readonly clock: Clock
  /** Padrão: `COVERAGE_CACHE_TTL_MS`. */
  readonly ttlMs?: number
}): CoverageSource {
  const ttlMs = deps.ttlMs ?? COVERAGE_CACHE_TTL_MS
  let cached: CachedCoverage | null = null

  function load(now: number): Promise<CoverageSnapshot> {
    const snapshot = deps.coverageRepository.loadCoverage()
    const entry: CachedCoverage = { snapshot, loadedAt: now }
    cached = entry
    snapshot.catch(() => {
      // Só esquece a leitura que falhou se nenhuma outra a substituiu nesse meio-tempo.
      if (cached === entry) {
        cached = null
      }
    })
    return snapshot
  }

  return () => {
    const now = deps.clock.now().getTime()
    const entry = cached
    // Relógio que voltou (`now < loadedAt`) também relê.
    const fresh = entry !== null && now >= entry.loadedAt && now - entry.loadedAt < ttlMs
    return fresh ? entry.snapshot : load(now)
  }
}

/**
 * `CheckCoverage`: decide se as famílias pedidas cobrem a data de referência. Uma data posterior ao
 * `verified_at` recusa sem chamar o LLM.
 */
export type CheckCoverage = (
  date: IsoDate,
  families: readonly string[],
) => Promise<CoverageDecision>

export function createCheckCoverage(deps: { readonly coverage: CoverageSource }): CheckCoverage {
  return async (date, families) => {
    const snapshot = await deps.coverage()
    return decideCoverage(date, families, snapshot.families)
  }
}

/** `GetCoverage` (`GET /api/v1/coverage`): cobertura efetiva de todas as famílias. */
export type GetCoverage = () => Promise<CoverageResponse>

export function createGetCoverage(deps: { readonly coverage: CoverageSource }): GetCoverage {
  return async () => {
    const snapshot = await deps.coverage()
    return {
      corpusVersion: snapshot.corpusVersion,
      families: snapshot.families.map(effectiveFamilyCoverage),
    }
  }
}
