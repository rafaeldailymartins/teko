import { isoDateSchema, type ValidityInterval, validityIntervalSchema } from '@teko/shared/vigencia'
import { z } from 'zod'
import { ReviewStatus } from './family.ts'
import type { ParsedProvision, ParsedSource, ParsedVersion, ReviewFlag } from './parsed-source.ts'
import { isStableKey } from './provision-id.ts'

/**
 * Overrides da revisão manual (`corpus/overrides/*.yaml`, aprovados por PR). Cada resolução vale
 * para uma anomalia da `review_queue`, identificada pela chave `(stable_key, note_hash)`: a chave
 * estável do dispositivo e o hash da nota que gerou a dúvida (o mesmo `reviewNoteHash` que o
 * `IngestDocumentVersion` grava na fila). A aplicação é pura e acontece entre o parser e o caso de
 * uso: a redação resolvida chega ao banco já `approved` ou `rejected`, sem `review`, e não volta
 * para a fila.
 *
 * Ações:
 * - `approve`: a redação vale como o parser a leu (`review_status = approved`);
 * - `reject`: a redação fica gravada como `rejected` (fora da busca e do `pv_no_overlap`);
 * - `set_interval`: a redação vale, com o intervalo `[from, to)` decidido na revisão.
 */

export const OverrideAction = {
  Approve: 'approve',
  Reject: 'reject',
  SetInterval: 'set_interval',
} as const
export type OverrideAction = (typeof OverrideAction)[keyof typeof OverrideAction]

const noteHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, { error: 'note_hash: sha256 hexadecimal' })

const baseOverride = {
  stable_key: z.string().refine(isStableKey, { error: 'stable_key inválida' }),
  note_hash: noteHashSchema,
  /** Por que a anomalia foi resolvida assim (vai para o log do run). */
  reason: z.string().trim().min(1),
  /** Quem revisou (usuário do GitHub) e quando. */
  reviewed_by: z.string().trim().min(1),
  reviewed_at: isoDateSchema,
}

/**
 * Uma resolução. `valid_during` só existe (e é obrigatório) em `set_interval`, sempre com limite
 * inferior: redação sem início não é publicável.
 */
export const overrideSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...baseOverride, action: z.literal(OverrideAction.Approve) }),
  z.strictObject({ ...baseOverride, action: z.literal(OverrideAction.Reject) }),
  z.strictObject({
    ...baseOverride,
    action: z.literal(OverrideAction.SetInterval),
    valid_during: validityIntervalSchema.refine((interval) => interval.from !== null, {
      error: 'valid_during precisa de limite inferior',
    }),
  }),
])
export type Override = z.output<typeof overrideSchema>

/** Um arquivo de overrides: lista de resoluções, sem chave repetida. */
export const overrideFileSchema = z.array(overrideSchema).superRefine((overrides, ctx) => {
  const seen = new Set<string>()
  for (const [index, override] of overrides.entries()) {
    const key = overrideKey(override.stable_key, override.note_hash)
    if (seen.has(key)) {
      ctx.addIssue({ code: 'custom', path: [index], message: `chave repetida: ${key}` })
    }
    seen.add(key)
  }
})

export function overrideKey(stableKey: string, noteHash: string): string {
  return `${stableKey}#${noteHash}`
}

export class DuplicateOverrideError extends Error {
  constructor(key: string) {
    super(`override repetido entre arquivos: ${key}`)
    this.name = 'DuplicateOverrideError'
  }
}

/** Indexa as resoluções pela chave; a mesma chave em dois arquivos é erro. */
export function indexOverrides(overrides: readonly Override[]): ReadonlyMap<string, Override> {
  const index = new Map<string, Override>()
  for (const override of overrides) {
    const key = overrideKey(override.stable_key, override.note_hash)
    if (index.has(key)) {
      throw new DuplicateOverrideError(key)
    }
    index.set(key, override)
  }
  return index
}

/** Hash da nota de uma anomalia (injetado: o domínio não conhece o algoritmo). */
export type NoteHasher = (flag: ReviewFlag) => string

interface AppliedOverride {
  readonly stableKey: string
  readonly noteHash: string
  readonly action: OverrideAction
}

export interface OverrideResult {
  readonly source: ParsedSource
  /** Resoluções que encontraram a anomalia nesta versão de documento. */
  readonly applied: readonly AppliedOverride[]
}

function resolveVersion(version: ParsedVersion, override: Override): ParsedVersion {
  const { review: _review, ...rest } = version
  switch (override.action) {
    case OverrideAction.Approve:
      return { ...rest, reviewStatus: ReviewStatus.Approved }
    case OverrideAction.Reject:
      return { ...rest, reviewStatus: ReviewStatus.Rejected }
    case OverrideAction.SetInterval: {
      const validDuring: ValidityInterval = override.valid_during
      return { ...rest, validDuring, reviewStatus: ReviewStatus.Approved }
    }
  }
}

/**
 * Aplica as resoluções às redações com `review` de um `ParsedSource`. Redações sem anomalia e
 * anomalias sem resolução passam intactas (as últimas seguem para a fila como `pending`).
 */
export function applyOverrides(
  source: ParsedSource,
  overrides: ReadonlyMap<string, Override>,
  noteHash: NoteHasher,
): OverrideResult {
  if (overrides.size === 0) {
    return { source, applied: [] }
  }
  const applied: AppliedOverride[] = []
  const provisions = source.provisions.map((provision): ParsedProvision => {
    let changed = false
    const versions = provision.versions.map((version) => {
      if (version.review === undefined) {
        return version
      }
      const hash = noteHash(version.review)
      const override = overrides.get(overrideKey(provision.stableKey, hash))
      if (override === undefined) {
        return version
      }
      changed = true
      applied.push({ stableKey: provision.stableKey, noteHash: hash, action: override.action })
      return resolveVersion(version, override)
    })
    return changed ? { ...provision, versions } : provision
  })
  return { source: { ...source, provisions }, applied }
}
