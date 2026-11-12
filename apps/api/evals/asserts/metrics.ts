import { compareIsoDates, containsDate, type ValidityInterval } from '@teko/shared/vigencia'
import { z } from 'zod'
import type { GoldenCase } from '../datasets/schema.ts'

/**
 * Métricas das retrieval evals, puras e testadas à parte (`metrics.test.ts`). Cada assert do
 * promptfoo é um invólucro fino destas funções; o gate é a média por métrica
 * (`scripts/check-thresholds.ts` contra `thresholds.json`).
 */

/** O que o provider `retrieval.ts` devolve como `output` (JSON). */
export const retrievalOutputSchema = z.object({
  outcome: z.enum(['evidence', 'refused', 'needs_clarification']),
  reason: z.string().nullable(),
  referenceDate: z.string().nullable(),
  candidates: z.array(z.string()),
  mode: z.string().nullable(),
  hits: z.array(
    z.object({
      stableKey: z.string(),
      validity: z.object({ from: z.string().nullable(), to: z.string().nullable() }),
      versionLabel: z.string(),
      rrf: z.number(),
    }),
  ),
  /**
   * Corpus avaliado (`EVAL_CORPUS`): a fixture (retrieval evals do PR, padrão) ou o corpus real do
   * staging (`corpus-eval`), que usa `staging_validity` quando o caso a define.
   */
  corpus: z.enum(['fixture', 'staging']).optional(),
  /** Candidatos antes do reranker, na ordem do RRF (só com `EVAL_POOL_SIZE`; ADR 0027). */
  pool: z.array(z.object({ stableKey: z.string(), text: z.string() })).optional(),
  /**
   * Estado no banco de cada dispositivo esperado que ficou fora do top-k (só no `corpus-eval` e no
   * provider local): separa dado faltando (sem redação na data, `pending`, sem embedding) de ranking.
   */
  diagnostics: z
    .array(
      z.object({
        stableKey: z.string(),
        versions: z.array(
          z.object({ reviewStatus: z.string(), chunks: z.number(), embedded: z.number() }),
        ),
      }),
    )
    .optional(),
})
export type RetrievalOutput = z.infer<typeof retrievalOutputSchema>

/** Resumo do estado no banco de um dispositivo que faltou: o que impede (ou não) que ele apareça. */
export function describeMissing(output: RetrievalOutput, stableKey: string): string {
  const diagnostic = output.diagnostics?.find((item) => item.stableKey === stableKey)
  if (diagnostic === undefined) {
    return stableKey
  }
  if (diagnostic.versions.length === 0) {
    return `${stableKey} (sem redação na data)`
  }
  const states = diagnostic.versions.map(
    (version) =>
      `${version.reviewStatus}, ${String(version.embedded)}/${String(version.chunks)} chunks com embedding`,
  )
  return `${stableKey} (${states.join('; ')})`
}

export const RECALL_K = 10

export interface MetricResult {
  /** `null` = a métrica não se aplica ao caso (não entra na média). */
  readonly score: number | null
  readonly reason: string
}

const notApplicable = (reason: string): MetricResult => ({ score: null, reason })

function expectedStableKeys(golden: GoldenCase): readonly string[] {
  return golden.expected.provisions
}

/**
 * Dispositivos distintos na ordem em que aparecem. O golden espera dispositivos (a citação é por
 * dispositivo), e uma redação longa vira vários chunks seguidos: contar chunk a chunk puniria o
 * acerto e deixaria um dispositivo ocupar várias posições do top-k.
 */
export function rankedProvisions(output: RetrievalOutput): string[] {
  return [...new Set(output.hits.map((hit) => hit.stableKey))]
}

/** recall@10: fração das `stable_key` esperadas entre os 10 primeiros dispositivos distintos. */
export function recallAtK(golden: GoldenCase, output: RetrievalOutput, k = RECALL_K): MetricResult {
  if (golden.expected.status !== 'answered') {
    return notApplicable('caso sem resposta esperada')
  }
  const expected = expectedStableKeys(golden)
  const top = new Set(rankedProvisions(output).slice(0, k))
  const found = expected.filter((key) => top.has(key))
  return {
    score: found.length / expected.length,
    reason: `${String(found.length)}/${String(expected.length)} no top-${String(k)}; faltou: ${
      expected
        .filter((key) => !top.has(key))
        .map((key) => describeMissing(output, key))
        .join(', ') || 'nada'
    }`,
  }
}

/** MRR: 1/posição do primeiro dispositivo esperado na lista de distintos (0 se nenhum aparece). */
export function reciprocalRank(golden: GoldenCase, output: RetrievalOutput): MetricResult {
  if (golden.expected.status !== 'answered') {
    return notApplicable('caso sem resposta esperada')
  }
  const expected = new Set(expectedStableKeys(golden))
  const index = rankedProvisions(output).findIndex((key) => expected.has(key))
  return {
    score: index === -1 ? 0 : 1 / (index + 1),
    reason:
      index === -1
        ? 'nenhum esperado nos resultados'
        : `primeiro esperado na posição ${String(index + 1)}`,
  }
}

function sameInterval(a: ValidityInterval, b: { from: string | null; to: string | null }): boolean {
  return a.from === b.from && a.to === b.to
}

/**
 * Vigência correta: todo resultado está em vigor na data de referência e, quando o caso fixa a
 * vigência esperada, a redação do dispositivo esperado no top-10 é exatamente aquela.
 */
export function validityCorrect(golden: GoldenCase, output: RetrievalOutput): MetricResult {
  if (golden.expected.status !== 'answered' || output.referenceDate === null) {
    return notApplicable('caso sem resposta esperada')
  }
  const date = output.referenceDate
  const outside = output.hits.filter((hit) => !containsDate(hit.validity, date))
  if (outside.length > 0) {
    return {
      score: 0,
      reason: `fora da vigência em ${date}: ${outside.map((hit) => hit.stableKey).join(', ')}`,
    }
  }
  const expectedValidity =
    output.corpus === 'staging'
      ? (golden.expected.staging_validity ?? golden.expected.validity)
      : golden.expected.validity
  const [firstKey] = expectedStableKeys(golden)
  if (expectedValidity === undefined || firstKey === undefined) {
    return { score: 1, reason: 'todos os resultados em vigor na data' }
  }
  const inTop = rankedProvisions(output).slice(0, RECALL_K).includes(firstKey)
  const hit = output.hits.find((candidate) => candidate.stableKey === firstKey)
  if (!inTop || hit === undefined) {
    return notApplicable(`${firstKey} fora do top-${String(RECALL_K)} (medido pelo recall)`)
  }
  return sameInterval(expectedValidity, hit.validity)
    ? { score: 1, reason: 'redação esperada' }
    : {
        score: 0,
        reason: `vigência ${JSON.stringify(hit.validity)} ≠ esperada ${JSON.stringify(expectedValidity)}`,
      }
}

/** Recusa fora da cobertura: o caso esperado como `refused` precisa ser recusado pelo motivo certo. */
export function refusalCorrect(golden: GoldenCase, output: RetrievalOutput): MetricResult {
  if (golden.expected.status !== 'refused') {
    return notApplicable('caso não é de recusa')
  }
  const ok = output.outcome === 'refused' && output.reason === golden.expected.refusal_reason
  return { score: ok ? 1 : 0, reason: `obtido ${output.outcome}/${String(output.reason)}` }
}

/** Ambiguidade: `needs_clarification` com exatamente as datas candidatas esperadas. */
export function clarificationCorrect(golden: GoldenCase, output: RetrievalOutput): MetricResult {
  if (golden.expected.status !== 'needs_clarification') {
    return notApplicable('caso não é ambíguo')
  }
  const expected = [...(golden.expected.candidates ?? [])].sort(compareIsoDates)
  const actual = [...output.candidates].sort(compareIsoDates)
  const ok = output.outcome === 'needs_clarification' && expected.join() === actual.join()
  return { score: ok ? 1 : 0, reason: `obtido ${output.outcome} [${actual.join(', ')}]` }
}

/** Data de referência resolvida igual à esperada (quando o caso a fixa). */
export function referenceDateCorrect(golden: GoldenCase, output: RetrievalOutput): MetricResult {
  if (golden.expected.reference_date === undefined) {
    return notApplicable('caso sem data esperada')
  }
  const ok = output.referenceDate === golden.expected.reference_date
  return { score: ok ? 1 : 0, reason: `obtida ${String(output.referenceDate)}` }
}

export const METRICS = {
  'recall@10': recallAtK,
  mrr: reciprocalRank,
  vigencia: validityCorrect,
  recusa: refusalCorrect,
  clarificacao: clarificationCorrect,
  data_referencia: referenceDateCorrect,
} as const satisfies Record<string, (golden: GoldenCase, output: RetrievalOutput) => MetricResult>

export type MetricName = keyof typeof METRICS
