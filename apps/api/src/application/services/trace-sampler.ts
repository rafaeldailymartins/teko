import { DISPLAY_TIME_ZONE } from '@teko/shared/i18n'
import { type IsoDate, isoDateInTimeZone } from '@teko/shared/vigencia'
import { nextMidnightMs } from '#domain/shared/time-zone.ts'
import type { Clock } from '../ports/clock.ts'
import type {
  GenerationObservation,
  GenerationStart,
  LlmTracingPort,
  QueryObservations,
  QueryTraceEnd,
  QueryTraceStart,
  RetrievalObservation,
} from '../ports/llm-tracing.ts'

/**
 * `TraceSampler` (`docs/architecture/observabilidade.md`, "Langfuse Cloud Hobby (EU)"): decide no
 * início do `rag-query`, pelo hash do `questionId`, se a pergunta vira trace no Langfuse. A flag
 * `sampled` do navegador não entra (o OTel continua amostrando tudo para o Grafana).
 *
 * - A taxa do ambiente vale até a projeção mensal de units (`usage_daily.langfuse_units` do mês,
 *   no fuso de São Paulo, projetada linearmente) chegar ao corte; dali em diante, a taxa reduzida.
 *   Produção: 1,0 → 0,2 em 35k; staging: 0,1; CI: 0.
 * - O total do mês fica em memória por `cacheTtlMs` (uma consulta a cada 10 min por instância);
 *   falha na leitura vale como corte atingido (a taxa menor), sem falhar a pergunta.
 *
 * O `QueryTracer` embrulha a porta: conta as units de cada trace (trace + observations) e engole
 * falhas do adapter, que nunca derrubam a resposta.
 */

export interface SamplingPolicy {
  /** Taxa até o corte, em [0, 1]. */
  readonly rate: number
  /** Taxa depois do corte (nunca acima de `rate`). */
  readonly overBudgetRate: number
  /** Units projetadas no mês a partir das quais vale a taxa reduzida. */
  readonly monthlyUnitsCutoff: number
}

const DAY_MS = 86_400_000
const FNV_OFFSET = 0x81_1c_9d_c5
const FNV_PRIME = 0x01_00_01_93
const TWO_POW_32 = 0x1_00_00_00_00
/** Leitura do total do mês, por instância. */
export const UNITS_CACHE_TTL_MS = 10 * 60_000

/** Posição determinística do id em [0, 1): FNV-1a de 32 bits sobre as unidades de código. */
export function samplingBucket(id: string): number {
  let hash = FNV_OFFSET
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME) >>> 0
  }
  return hash / TWO_POW_32
}

export function isSampled(id: string, rate: number): boolean {
  return samplingBucket(id) < rate
}

/** Primeiro dia do mês corrente em São Paulo e a fração do mês já decorrida, em dias (piso 1). */
export function monthProgress(now: Date): {
  readonly firstDay: IsoDate
  readonly elapsedDays: number
  readonly daysInMonth: number
} {
  const today = isoDateInTimeZone(now, DISPLAY_TIME_ZONE)
  const [year, month, day] = today.split('-').map(Number) as [number, number, number]
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const leftToday = (nextMidnightMs(now.getTime(), DISPLAY_TIME_ZONE) - now.getTime()) / DAY_MS
  return {
    firstDay: `${today.slice(0, 7)}-01`,
    elapsedDays: Math.max(1, day - leftToday),
    daysInMonth,
  }
}

/** Projeção linear do mês: `usado / dias decorridos × dias do mês`. */
export function projectMonthlyUnits(used: number, now: Date): number {
  const { elapsedDays, daysInMonth } = monthProgress(now)
  return (used / elapsedDays) * daysInMonth
}

/** Taxa em vigor para a projeção dada. */
export function samplingRate(policy: SamplingPolicy, projectedUnits: number | null): number {
  const reduced = Math.min(policy.rate, policy.overBudgetRate)
  return projectedUnits === null || projectedUnits >= policy.monthlyUnitsCutoff
    ? reduced
    : policy.rate
}

export interface TraceSampler {
  shouldSample(questionId: string): Promise<boolean>
}

export function createTraceSampler(deps: {
  readonly policy: SamplingPolicy
  /** Soma de `usage_daily.langfuse_units` (linha `global`) desde o dia dado. */
  readonly unitsSince: (day: IsoDate) => Promise<number>
  readonly clock: Clock
  /** Validade da projeção em memória (padrão: `UNITS_CACHE_TTL_MS`). */
  readonly cacheTtlMs?: number
}): TraceSampler {
  const ttl = deps.cacheTtlMs ?? UNITS_CACHE_TTL_MS
  // A projeção (e não só o total) fica em cache: as perguntas simultâneas dividem a mesma leitura,
  // e uma falha vale pelo TTL inteiro. Na virada do mês, a projeção velha vale até o TTL vencer.
  let cached: { readonly atMs: number; readonly projected: Promise<number | null> } | null = null

  function projected(): Promise<number | null> {
    const now = deps.clock.now()
    if (cached === null || now.getTime() - cached.atMs >= ttl) {
      cached = {
        atMs: now.getTime(),
        projected: deps.unitsSince(monthProgress(now).firstDay).then(
          (used) => projectMonthlyUnits(used, now),
          () => null,
        ),
      }
    }
    return cached.projected
  }

  return {
    async shouldSample(questionId) {
      const policy = deps.policy
      if (policy.rate <= 0) {
        return false
      }
      // Sem chance de corte (as duas taxas iguais), nem lê o banco.
      const rate =
        Math.min(policy.rate, policy.overBudgetRate) >= policy.rate
          ? policy.rate
          : samplingRate(policy, await projected())
      return isSampled(questionId, rate)
    },
  }
}

/** Um trace em andamento, com as units já contadas; inerte quando a pergunta não foi amostrada. */
export interface QueryTrace {
  /** `trace_id` gravado em `app.questions.langfuse_trace_id`; `null` sem amostragem. */
  readonly traceId: string | null
  /** Units do Langfuse geradas até agora (trace + observations). */
  units(): number
  retrieval(startedAtMs: number): RetrievalObservation
  generation(start: GenerationStart): GenerationObservation
  end(result: QueryTraceEnd): void
}

const ignore = (): void => {}
const inertObservation = { end: ignore }

export const untracedQuery: QueryTrace = {
  traceId: null,
  units: () => 0,
  retrieval: () => inertObservation,
  generation: () => inertObservation,
  end: ignore,
}

export interface QueryTracer {
  start(start: QueryTraceStart): Promise<QueryTrace>
}

/** Sem backend de traces de LLM (CI, testes, `LLM_TRACING_BACKEND=off`). */
export const disabledQueryTracer: QueryTracer = { start: () => Promise.resolve(untracedQuery) }

/** Chama o adapter sem deixar uma falha dele chegar à resposta. */
function guarded<T>(work: () => T, fallback: T): T {
  try {
    return work()
  } catch {
    return fallback
  }
}

function tracedQuery(observations: QueryObservations): QueryTrace {
  // O trace e a observation raiz (`rag-query`).
  let units = 2
  let ended = false
  return {
    traceId: observations.traceId,
    units: () => units,
    retrieval(startedAtMs) {
      units += 1
      return guarded(() => observations.retrieval(startedAtMs), inertObservation)
    },
    generation(start) {
      units += 1
      return guarded(() => observations.generation(start), inertObservation)
    },
    end(result) {
      if (ended) {
        return
      }
      ended = true
      guarded(() => {
        observations.end(result)
      }, undefined)
    },
  }
}

export function createQueryTracer(deps: {
  readonly sampler: TraceSampler
  readonly port: LlmTracingPort
}): QueryTracer {
  return {
    async start(start) {
      if (!(await deps.sampler.shouldSample(start.questionId))) {
        return untracedQuery
      }
      const observations = guarded<QueryObservations | null>(
        () => deps.port.startQuery(start),
        null,
      )
      return observations === null ? untracedQuery : tracedQuery(observations)
    },
  }
}
