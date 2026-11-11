import { isoDateInTimeZone, type ReferenceInput, type ReferenceSource } from '@teko/shared/vigencia'
import {
  type ReferenceResolution,
  resolveReferenceDate,
} from '#domain/vigencia/reference-resolution.ts'
import type { Clock } from '../ports/clock.ts'

/**
 * `ResolveReferenceDate`: aplica a precedência do domínio com "hoje" calculado pelo `Clock` em
 * `America/Sao_Paulo` (o default é o mês anterior a hoje).
 */
export interface ResolveReferenceDateCommand {
  readonly input: ReferenceInput
  readonly source: ReferenceSource
  readonly questionText: string
}

export type ResolveReferenceDate = (command: ResolveReferenceDateCommand) => ReferenceResolution

export function createResolveReferenceDate(deps: { readonly clock: Clock }): ResolveReferenceDate {
  return (command) =>
    resolveReferenceDate({ ...command, today: isoDateInTimeZone(deps.clock.now()) })
}
