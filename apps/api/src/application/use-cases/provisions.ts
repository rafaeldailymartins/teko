import type {
  DiffSegment,
  FieldChange,
  ProvisionDiffResponse,
  ProvisionSearchResponse,
  ProvisionTimelineResponse,
  ProvisionVersion,
} from '@teko/shared/contracts'
import { type IsoDate, isoDateInTimeZone } from '@teko/shared/vigencia'
import type { ReviewStatus } from '#domain/corpus/family.ts'
import { wordDiff } from '#domain/corpus/word-diff.ts'
import type { Clock } from '../ports/clock.ts'
import type { ProvisionRepository, ProvisionVersionRecord } from '../ports/provision-repository.ts'

/**
 * Casos de uso de leitura de dispositivos: `SearchProvisions` (paleta), `GetProvisionTimeline` e
 * `GetProvisionDiff`. Não chamam LLM nem embeddings; só leem o corpus publicado.
 */

/** Tamanho do trecho mostrado na paleta. */
export const EXCERPT_LENGTH = 200

export interface ProvisionUseCases {
  search(command: {
    readonly q: string
    readonly family?: string | undefined
    readonly at?: IsoDate | undefined
  }): Promise<ProvisionSearchResponse>
  /** `null` = dispositivo inexistente (404). */
  timeline(stableKey: string): Promise<ProvisionTimelineResponse | null>
  /** `null` = dispositivo inexistente (404). */
  diff(stableKey: string, from: IsoDate, to: IsoDate): Promise<ProvisionDiffResponse | null>
}

export interface ProvisionUseCasesDeps {
  readonly repository: ProvisionRepository
  readonly reviewStatuses: readonly ReviewStatus[]
  readonly clock: Clock
  readonly limit: number
}

export function excerptOf(text: string): string {
  const flat = text.replaceAll(/\s+/g, ' ').trim()
  return flat.length <= EXCERPT_LENGTH ? flat : `${flat.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…`
}

/** Valores de `structured` como texto (os parsers gravam strings; o resto vira JSON). */
export function fieldsOf(
  structured: Readonly<Record<string, unknown>> | null,
): Record<string, string> | null {
  if (structured === null) {
    return null
  }
  const fields: Record<string, string> = {}
  for (const [name, value] of Object.entries(structured)) {
    if (value === null || value === undefined) {
      continue
    }
    fields[name] = typeof value === 'string' ? value : JSON.stringify(value)
  }
  return fields
}

function toVersion(record: ProvisionVersionRecord): ProvisionVersion {
  return {
    label: record.label,
    validity: record.validity,
    text: record.text,
    act: record.act,
    fields: fieldsOf(record.structured),
  }
}

/** Redação vigente na data (`[from, to)`), ou `null`. */
export function versionAt<T extends { readonly validity: ProvisionVersion['validity'] }>(
  versions: readonly T[],
  date: IsoDate,
): T | null {
  return (
    versions.find(
      ({ validity }) =>
        (validity.from === null || validity.from <= date) &&
        (validity.to === null || date < validity.to),
    ) ?? null
  )
}

export function fieldChangesOf(
  before: Record<string, string> | null,
  after: Record<string, string> | null,
): FieldChange[] {
  const names = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
  return names.flatMap((field) => {
    const old = before?.[field] ?? null
    const next = after?.[field] ?? null
    return old === next ? [] : [{ field, before: old, after: next }]
  })
}

export function createProvisionUseCases(deps: ProvisionUseCasesDeps): ProvisionUseCases {
  return {
    async search({ q, family, at }) {
      const date = at ?? isoDateInTimeZone(deps.clock.now())
      const matches = await deps.repository.search({
        text: q,
        family: family ?? null,
        at: date,
        reviewStatuses: deps.reviewStatuses,
        limit: deps.limit,
      })
      return {
        at: date,
        items: matches.map((match) => ({
          stableKey: match.stableKey,
          label: match.label,
          family: match.family,
          jurisdiction: match.jurisdiction,
          validity: match.validity,
          excerpt: excerptOf(match.text),
        })),
      }
    },

    async timeline(stableKey) {
      const history = await deps.repository.history(stableKey, deps.reviewStatuses)
      if (history === null) {
        return null
      }
      return {
        stableKey: history.stableKey,
        family: history.family,
        jurisdiction: history.jurisdiction,
        versions: history.versions.map(toVersion),
      }
    },

    async diff(stableKey, from, to) {
      const history = await deps.repository.history(stableKey, deps.reviewStatuses)
      if (history === null) {
        return null
      }
      const versions = history.versions.map(toVersion)
      const before = versionAt(versions, from)
      const after = versionAt(versions, to)
      const segments: DiffSegment[] = wordDiff(before?.text ?? '', after?.text ?? '')
      return {
        stableKey: history.stableKey,
        before,
        after,
        segments,
        fieldChanges: fieldChangesOf(before?.fields ?? null, after?.fields ?? null),
      }
    },
  }
}
