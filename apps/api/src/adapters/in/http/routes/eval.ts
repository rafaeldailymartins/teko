import { familySchema, retrievalModeSchema } from '@teko/shared/contracts'
import {
  isoDateSchema,
  periodoApuracaoSchema,
  referenceSourceSchema,
  validityIntervalSchema,
} from '@teko/shared/vigencia'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { RetrievalOutcome } from '#app/use-cases/retrieve-evidence.ts'

/**
 * Rotas de avaliação (`/api/v1/_eval/*`), num plugin à parte que o `buildApp` só registra com
 * `APP_ENV=ci` (stack descartável de CI: evals de geração, red team e k6 da F8). Em staging e
 * produção elas não existem (404), e o boot recusa o registro fora do CI.
 *
 * `GET /api/v1/_eval/search` devolve o resultado do `RetrieveEvidence` (data → cobertura → busca)
 * no formato das retrieval evals, sem LLM. O `POST /api/v1/_eval/answer` chega com a cadeia de
 * LLM.
 */
const EVAL_PREFIX = '/api/v1/_eval'

const evalSearchQuerySchema = z
  .strictObject({
    question: z.string().trim().min(1).max(1000),
    /** Famílias separadas por vírgula; ausente = todas. */
    families: z
      .string()
      .transform((value) => value.split(',').filter((family) => family !== ''))
      .pipe(z.array(familySchema).max(10))
      .optional(),
    periodoApuracao: periodoApuracaoSchema.optional(),
    referenceDate: isoDateSchema.optional(),
    source: referenceSourceSchema,
  })
  .refine(
    (query) => (query.periodoApuracao === undefined) !== (query.referenceDate === undefined),
    {
      message: 'Informe exatamente um entre periodoApuracao e referenceDate',
      path: ['referenceDate'],
    },
  )

const evalSearchResponseSchema = z.object({
  outcome: z.enum(RetrievalOutcome),
  reason: z.string().nullable(),
  referenceDate: isoDateSchema.nullable(),
  candidates: z.array(isoDateSchema),
  mode: retrievalModeSchema.nullable(),
  hits: z.array(
    z.object({
      stableKey: z.string(),
      validity: validityIntervalSchema,
      versionLabel: z.string(),
      rrf: z.number(),
    }),
  ),
})

export const evalRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    `${EVAL_PREFIX}/search`,
    {
      config: { rateLimit: false },
      schema: {
        operationId: 'evalSearch',
        summary: 'Recuperação sem LLM (só APP_ENV=ci)',
        tags: ['eval'],
        querystring: evalSearchQuerySchema,
        response: { 200: evalSearchResponseSchema },
      },
    },
    async (request) => {
      const retrieval = app.container.useCases.retrieval
      if (retrieval === null) {
        throw app.httpErrors.serviceUnavailable()
      }
      const { question, families, periodoApuracao, referenceDate, source } = request.query
      const result = await retrieval.retrieveEvidence({
        input:
          periodoApuracao === undefined
            ? { referenceDate: referenceDate ?? '' }
            : { periodoApuracao },
        source,
        questionText: question,
        families: families ?? [],
      })
      if (result.outcome === RetrievalOutcome.NeedsClarification) {
        return {
          outcome: result.outcome,
          reason: result.reason,
          referenceDate: null,
          candidates: [...result.candidates],
          mode: null,
          hits: [],
        }
      }
      const hits =
        result.outcome === RetrievalOutcome.Evidence
          ? result.evidence.map((item) => ({
              stableKey: item.stableKey,
              validity: item.validity,
              versionLabel: item.document.versionLabel,
              rrf: item.rrf,
            }))
          : []
      return {
        outcome: result.outcome,
        reason: result.outcome === RetrievalOutcome.Refused ? result.reason : null,
        referenceDate: result.reference.value,
        candidates: [],
        mode: result.mode,
        hits,
      }
    },
  )
}
