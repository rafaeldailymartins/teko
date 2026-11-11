import { z } from 'zod'
import { familyCoverageSchema } from './common.ts'

/** `GET /api/v1/coverage`: público (sem sessão), assinado pelo proxy, cache em memória de 10 min. */
export const coverageResponseSchema = z
  .object({
    corpusVersion: z.int().nonnegative(),
    families: z.array(familyCoverageSchema),
  })
  .meta({ description: 'Cobertura efetiva do corpus por família' })

export type CoverageResponse = z.infer<typeof coverageResponseSchema>
