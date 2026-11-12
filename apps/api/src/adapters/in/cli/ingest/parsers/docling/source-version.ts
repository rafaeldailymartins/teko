import type { IsoDate, ValidityInterval } from '@teko/shared/vigencia'
import { type Modality, ReviewStatus, type ValidityBasis } from '#domain/corpus/family.ts'
import type {
  ParsedDocumentVersion,
  ParsedVersion,
  ReviewFlag,
} from '#domain/corpus/parsed-source.ts'
import { ParseError, type ParserInput } from '../parser.ts'

/**
 * Peças comuns aos parsers do SPED (Guia, Guia EFD-GO, NTs, leiautes da REINF): a versão de
 * documento a partir do `SourceDescriptor` já resolvido pelo pipeline e a montagem de uma redação.
 */

export interface ResolvedVersion {
  readonly version: ParsedDocumentVersion
  /** `versionValidDuring` do descritor: período do leiaute ou `[publicação, próxima)`. */
  readonly validDuring: ValidityInterval
}

/**
 * Versão de documento das fontes cujo rótulo, data e vigência vêm de `corpus/sources.yaml` e
 * `corpus/leiaute-periods.yaml` (o conteúdo não traz o período). Lança `ParseError` se faltar
 * algum deles.
 */
export function resolveDescribedVersion(input: ParserInput): ResolvedVersion {
  const { source } = input
  if (source.versionLabel === null || source.publishedOn === null) {
    throw new ParseError(`${source.id}: versionLabel e publishedOn são obrigatórios`)
  }
  if (source.versionValidDuring === null) {
    throw new ParseError(`${source.id}: versionValidDuring é obrigatório`)
  }
  return {
    validDuring: source.versionValidDuring,
    version: {
      versionLabel: source.versionLabel,
      publishedOn: source.publishedOn,
      validDuring: source.versionValidDuring,
      consolidatedUntil: null,
      actRef: source.actRef,
      sha256: input.sha256,
    },
  }
}

export interface VersionSpec {
  readonly displayLabel: string
  readonly validDuring: ValidityInterval
  readonly modality: Modality
  readonly validityBasis: ValidityBasis
  readonly retroactive?: boolean
  readonly text: string
  readonly review?: ReviewFlag | undefined
  readonly structured?: Readonly<Record<string, unknown>> | undefined
}

/** Redação com `reviewStatus` derivado: `pending` quando há `review`, `auto` no resto. */
export function buildVersion(spec: VersionSpec): ParsedVersion {
  return {
    displayLabel: spec.displayLabel,
    validDuring: spec.validDuring,
    modality: spec.modality,
    validityBasis: spec.validityBasis,
    retroactive: spec.retroactive ?? false,
    reviewStatus: spec.review === undefined ? ReviewStatus.Auto : ReviewStatus.Pending,
    review: spec.review,
    text: spec.text,
    structured: spec.structured,
  }
}

/** Formata `2024-11-04` como `04/11/2024` (rótulos de versão). */
export function formatBrazilianDate(date: IsoDate): string {
  const [year, month, day] = date.split('-')
  return `${day ?? ''}/${month ?? ''}/${year ?? ''}`
}
