import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { z } from 'zod'
import { WatchKind, WatchMode, type WatchPage } from '#app/ports/watch-signals.ts'
import { FAMILIES, type Family, isFamily } from '#domain/corpus/family.ts'

/**
 * Loader do `corpus/watch.yaml` (páginas monitoradas pelo `sources-watch`). O schema rejeita campos
 * desconhecidos, ids repetidos, URL que não seja `https`, regex inválido e família fora da lista.
 */

export const DEFAULT_WATCH_CONFIG = 'corpus/watch.yaml'

const family = z.custom<Family>(isFamily, {
  message: `família desconhecida (válidas: ${FAMILIES.join(', ')})`,
})

const regex = z.string().refine(
  (value) => {
    try {
      new RegExp(value, 'iu')
      return true
    } catch {
      return false
    }
  },
  { message: 'regex inválido' },
)

const httpsUrl = z.string().refine((value) => {
  try {
    return new URL(value.replaceAll('{yyyy}', '2026')).protocol === 'https:'
  } catch {
    return false
  }
}, 'URL https absoluta (aceita {yyyy})')

/** Slugs de documento do `corpus/sources.yaml` (conferidos contra ele no teste do arquivo real). */
const slugs = z.array(z.string().regex(/^[a-z0-9][a-z0-9-]*$/u, 'slug em kebab-case')).max(50)

const base = {
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u, 'id em kebab-case'),
  family,
  url: httpsUrl,
  mode: z.enum([WatchMode.Live, WatchMode.Pinned]).default(WatchMode.Live),
  encoding: z.enum(['utf-8', 'windows-1252']).default('utf-8'),
  covers: slugs.default([]),
}

const pageSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...base, kind: z.literal(WatchKind.Consolidated) }),
  z.strictObject({
    ...base,
    kind: z.literal(WatchKind.ActList),
    act: z.enum(['decreto', 'lei']),
    include: regex.nullable().default(null),
    exclude: regex.nullable().default(null),
  }),
  z.strictObject({
    ...base,
    kind: z.literal(WatchKind.DocumentIndex),
    documents: z
      .array(
        z.strictObject({
          pattern: regex,
          versionPattern: regex.nullable().default(null),
          covers: slugs.nullable().default(null),
        }),
      )
      .min(1),
  }),
  z.strictObject({
    ...base,
    kind: z.literal(WatchKind.TablesWs),
    tableIds: z.array(z.number().int().positive()).min(1),
  }),
])

const watchConfigSchema = z
  .strictObject({
    version: z.literal(1),
    pages: z.array(pageSchema).min(1),
  })
  .superRefine((config, context) => {
    const ids = new Set<string>()
    for (const [index, page] of config.pages.entries()) {
      if (ids.has(page.id)) {
        context.addIssue({
          code: 'custom',
          message: `id repetido: ${page.id}`,
          path: ['pages', index, 'id'],
        })
      }
      ids.add(page.id)
    }
  })

export class WatchConfigError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options)
    this.name = 'WatchConfigError'
  }
}

/** Valida o conteúdo YAML do `watch.yaml`. */
export function parseWatchConfig(text: string, source = DEFAULT_WATCH_CONFIG): WatchPage[] {
  let data: unknown
  try {
    data = parse(text)
  } catch (error) {
    throw new WatchConfigError(`${source}: YAML inválido`, { cause: error })
  }
  const result = watchConfigSchema.safeParse(data)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
    throw new WatchConfigError(`${source}: ${issues}`)
  }
  return result.data.pages
}

export async function loadWatchConfig(path = DEFAULT_WATCH_CONFIG): Promise<WatchPage[]> {
  return parseWatchConfig(await readFile(path, 'utf8'), path)
}
