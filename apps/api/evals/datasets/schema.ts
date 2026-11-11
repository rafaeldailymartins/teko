import { localeSchema } from '@teko/shared/i18n'
import {
  isoDateSchema,
  periodoApuracaoSchema,
  ReferenceSource,
  validityIntervalSchema,
} from '@teko/shared/vigencia'
import { z } from 'zod'
import { FAMILIES } from '#domain/corpus/family.ts'
import { isStableKey } from '#domain/corpus/provision-id.ts'

/**
 * Schema do dataset golden (`datasets/golden.yaml`). Cada caso é uma pergunta com a data de
 * referência como o cliente a envia (`reference_date` ou `periodo_apuracao`, mais a origem) e o
 * resultado esperado. As retrieval evals usam `expected.status`, `provisions`, `validity` e
 * `candidates`; as generation evals (F8) usam também `doc_version` e `facts`.
 *
 * Mudar o dataset obriga a regenerar a fixture (`pnpm fixtures:embed`), porque as perguntas
 * também têm embedding gravado.
 */

const GoldenStatus = {
  Answered: 'answered',
  Refused: 'refused',
  NeedsClarification: 'needs_clarification',
} as const

const stableKeySchema = z.string().refine(isStableKey, { message: 'stable_key inválida' })

export const goldenCaseSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    question: z.string().trim().min(1).max(1000),
    reference_date: isoDateSchema.optional(),
    periodo_apuracao: periodoApuracaoSchema.optional(),
    reference_source: z.enum(ReferenceSource),
    locale: localeSchema,
    /** Famílias pedidas; ausente = todas. */
    families: z.array(z.enum(FAMILIES)).min(1).optional(),
    expected: z.strictObject({
      status: z.enum(GoldenStatus),
      /** Data de referência que o `ResolveReferenceDate` deve devolver (answered/refused). */
      reference_date: isoDateSchema.optional(),
      refusal_reason: z.literal('out_of_coverage').optional(),
      /** Dispositivos que precisam aparecer no top-10 (recall@10 e MRR). */
      provisions: z.array(stableKeySchema).default([]),
      /** Rótulo da versão de documento que a citação deve trazer. */
      doc_version: z.string().min(1).optional(),
      /** Vigência da redação esperada (a do primeiro dispositivo de `provisions`). */
      validity: validityIntervalSchema.optional(),
      /** Fatos que a resposta gerada precisa conter (generation evals). */
      facts: z.array(z.string().min(1)).default([]),
      /** Datas candidatas de `needs_clarification`. */
      candidates: z.array(isoDateSchema).min(2).optional(),
    }),
    /** Agrupa casos do mesmo dispositivo em datas diferentes. */
    pair: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).min(1),
    source_url: z.url({ protocol: /^https$/ }),
    /** Trecho literal da fonte que sustenta a resposta esperada. */
    source_quote: z.string().min(1),
    curated_by: z.string().min(1),
    /** Data da revisão humana; `null` enquanto o mantenedor não revisou. */
    reviewed_at: isoDateSchema.nullable(),
  })
  .superRefine((golden, ctx) => {
    if ((golden.reference_date === undefined) === (golden.periodo_apuracao === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['reference_date'],
        message: 'informe exatamente um entre reference_date e periodo_apuracao',
      })
    }
    const { status, provisions, refusal_reason, candidates } = golden.expected
    if (status === GoldenStatus.Answered && provisions.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['expected', 'provisions'],
        message: 'answered exige ao menos um dispositivo',
      })
    }
    if (status === GoldenStatus.Refused && refusal_reason === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['expected', 'refusal_reason'],
        message: 'refused exige refusal_reason',
      })
    }
    if (status === GoldenStatus.NeedsClarification && candidates === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['expected', 'candidates'],
        message: 'needs_clarification exige candidates',
      })
    }
  })

export type GoldenCase = z.output<typeof goldenCaseSchema>

export const goldenDatasetSchema = z.array(goldenCaseSchema).superRefine((cases, ctx) => {
  const seen = new Set<string>()
  for (const [index, golden] of cases.entries()) {
    if (seen.has(golden.id)) {
      ctx.addIssue({ code: 'custom', path: [index, 'id'], message: `id repetido: ${golden.id}` })
    }
    seen.add(golden.id)
  }
})
