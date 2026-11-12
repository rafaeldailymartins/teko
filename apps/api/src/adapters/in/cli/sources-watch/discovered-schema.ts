import { isIsoDate } from '@teko/shared/vigencia'
import { z } from 'zod'
import { DiscoveredKind, type DiscoveredReport } from '#app/ports/watch-report.ts'
import { WatchMode } from '#app/ports/watch-signals.ts'
import { type Family, isFamily } from '#domain/corpus/family.ts'

/**
 * Validação do `discovered.json` lido pelo `cli coverage-mark` (artifact do job `detect`). O job
 * `mark-coverage` roda com credenciais de banco: o arquivo é tratado como entrada não confiável.
 */

const family = z.custom<Family>(isFamily, { message: 'família desconhecida' })
const isoDate = z.string().refine(isIsoDate, 'data ISO inválida')

const changeSchema = z.strictObject({
  family,
  sourceUrl: z.url({ protocol: /^https?$/u }),
  effectiveFrom: isoDate,
  versionLabel: z.string().max(200).nullable(),
  kind: z.enum([
    DiscoveredKind.Consolidated,
    DiscoveredKind.Act,
    DiscoveredKind.Document,
    DiscoveredKind.Table,
  ]),
  pageId: z.string().max(100),
  mode: z.enum([WatchMode.Live, WatchMode.Pinned]),
  status: z.enum(['new', 'pending']),
})

const reportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runDate: isoDate,
  generatedAt: z.string(),
  changes: z.array(changeSchema).max(1000),
  errors: z
    .array(z.strictObject({ pageId: z.string(), family, message: z.string().max(2000) }))
    .max(1000),
  unverifiedFamilies: z.array(family),
})

class DiscoveredReportError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options)
    this.name = 'DiscoveredReportError'
  }
}

export function parseDiscoveredReport(text: string): DiscoveredReport {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    throw new DiscoveredReportError('discovered.json não é JSON válido', { cause: error })
  }
  const result = reportSchema.safeParse(data)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
    throw new DiscoveredReportError(`discovered.json inválido: ${issues}`)
  }
  return result.data
}
