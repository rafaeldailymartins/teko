/*
 * Escolhas determinísticas do system test, sem rede: a pergunta do pool pelo número do run e as
 * datas de referência a partir da cobertura pública (`GET /api/v1/coverage`). O par (pergunta,
 * data) muda a cada run, então a primeira pergunta quase nunca já está no cache de respostas
 * (validade de 7 dias): o mesmo par só volta depois de 30 × 24 runs.
 */

export interface PoolQuestion {
  readonly family: string
  readonly question: string
}

interface CoveredInterval {
  readonly from: string | null
  readonly to: string | null
}

export interface FamilyCoverage {
  readonly family: string
  readonly covered: readonly CoveredInterval[]
  readonly verifiedAt: string
}

/** Quantos meses mais recentes da cobertura entram no rodízio da data. */
export const RECENT_MONTHS = 24

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Valida o pool versionado (`system/questions.json`): 30 perguntas não vazias, sem repetição. */
export function parsePool(value: unknown): PoolQuestion[] {
  if (!Array.isArray(value) || value.length !== 30) {
    throw new Error('questions.json: esperado um array com 30 perguntas')
  }
  const pool = value.map((item, index) => {
    if (
      !isRecord(item) ||
      typeof item['family'] !== 'string' ||
      typeof item['question'] !== 'string' ||
      item['question'].trim().length < 10 ||
      item['question'].length > 300
    ) {
      throw new Error(`questions.json: item ${index} sem family ou question válidos`)
    }
    return { family: item['family'], question: item['question'] }
  })
  if (new Set(pool.map((item) => item.question)).size !== pool.length) {
    throw new Error('questions.json: pergunta repetida')
  }
  return pool
}

/** Valida o corpo do `GET /api/v1/coverage` (só o que o plano usa). */
export function parseCoverage(value: unknown): FamilyCoverage[] {
  const families = isRecord(value) ? value['families'] : undefined
  if (!Array.isArray(families) || families.length === 0) {
    throw new Error('cobertura sem famílias')
  }
  return families.map((item) => {
    if (!isRecord(item) || typeof item['family'] !== 'string' || !Array.isArray(item['covered'])) {
      throw new Error('cobertura com família inválida')
    }
    const verifiedAt = item['verifiedAt']
    if (typeof verifiedAt !== 'string' || !ISO_DATE.test(verifiedAt)) {
      throw new Error(`cobertura de ${item['family']} sem verifiedAt`)
    }
    const covered = item['covered'].map((interval) => {
      const from = isRecord(interval) ? interval['from'] : undefined
      const to = isRecord(interval) ? interval['to'] : undefined
      const date = (raw: unknown) => (typeof raw === 'string' && ISO_DATE.test(raw) ? raw : null)
      return { from: date(from), to: date(to) }
    })
    return { family: item['family'], covered, verifiedAt }
  })
}

/** Número do run como inteiro não negativo (`GITHUB_RUN_NUMBER`); fora do CI, 0. */
export function runNumber(raw: string | undefined): number {
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

export function pickQuestion(pool: readonly PoolQuestion[], run: number): PoolQuestion {
  const question = pool[run % pool.length]
  if (question === undefined) {
    throw new Error('pool vazio')
  }
  return question
}

/** `AAAA-MM` do primeiro dia do mês de `date` (`AAAA-MM-DD`), deslocado `delta` meses. */
function shiftMonth(date: string, delta: number): string {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7)) - 1 + delta
  const shifted = new Date(Date.UTC(year, month, 1))
  return shifted.toISOString().slice(0, 7)
}

function isCovered(day: string, family: FamilyCoverage): boolean {
  return (
    day <= family.verifiedAt &&
    family.covered.some(
      (interval) =>
        (interval.from === null || interval.from <= day) &&
        (interval.to === null || day < interval.to),
    )
  )
}

/**
 * Períodos de apuração (`AAAA-MM`) cujo primeiro dia a família cobre, do mais recente para trás,
 * até {@link RECENT_MONTHS}.
 */
export function coveredPeriodos(family: FamilyCoverage): string[] {
  const periodos: string[] = []
  let periodo = family.verifiedAt.slice(0, 7)
  for (let step = 0; step < 600 && periodos.length < RECENT_MONTHS; step += 1) {
    if (isCovered(`${periodo}-01`, family)) {
      periodos.push(periodo)
    }
    periodo = shiftMonth(`${periodo}-01`, -1)
  }
  return periodos
}

/** Período da pergunta do run: rodízio entre os meses cobertos pela família dela. */
export function pickPeriodo(
  coverage: readonly FamilyCoverage[],
  question: PoolQuestion,
  run: number,
  poolSize: number,
): string {
  const family = coverage.find((item) => item.family === question.family)
  const periodos = family === undefined ? [] : coveredPeriodos(family)
  const periodo = periodos[Math.floor(run / poolSize) % Math.max(periodos.length, 1)]
  if (periodo === undefined) {
    throw new Error(
      `a família ${question.family} não cobre nenhum mês: revise system/questions.json`,
    )
  }
  return periodo
}

/**
 * Período fora de toda a cobertura, para a recusa `out_of_coverage` (sem LLM e sem cota): o mês
 * anterior ao início mais antigo, se toda família tem início; senão o mês seguinte ao último
 * `verifiedAt` (data posterior à verificação nunca é coberta).
 */
export function outOfCoveragePeriodo(coverage: readonly FamilyCoverage[]): string {
  const starts = coverage.flatMap((family) => family.covered.map((interval) => interval.from))
  if (starts.length > 0 && starts.every((start): start is string => start !== null)) {
    const earliest = [...starts].sort()[0] ?? ''
    const before = shiftMonth(earliest, -1)
    if (coverage.every((family) => !isCovered(`${before}-01`, family))) {
      return before
    }
  }
  const latest = [...coverage.map((family) => family.verifiedAt)].sort().at(-1) ?? ''
  return shiftMonth(latest, 1)
}
