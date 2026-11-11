import { Jurisdiction } from '@teko/shared/contracts'

/**
 * Famílias do corpus. Cada família tem uma jurisdição fixa e uma base de vigência dominante
 * (ver "Corpus por ondas" no plano). A cobertura (`corpus.coverage`) e o filtro da busca são por
 * família.
 */
export const Family = {
  EfdIcmsIpi: 'efd-icms-ipi',
  EfdReinf: 'efd-reinf',
  Rcte: 'rcte',
  Cte: 'cte',
  EfdGo: 'efd-go',
  TabelasGo: 'tabelas-go',
  /** Anexos VIII e IX do RCTE: onda C3 (F10); até lá, sem cobertura. */
  RcteAnexos: 'rcte-anexos',
} as const
export type Family = (typeof Family)[keyof typeof Family]

export const FAMILIES: readonly Family[] = Object.values(Family)

const FAMILY_JURISDICTION = {
  [Family.EfdIcmsIpi]: Jurisdiction.Federal,
  [Family.EfdReinf]: Jurisdiction.Federal,
  [Family.Rcte]: Jurisdiction.Goias,
  [Family.Cte]: Jurisdiction.Goias,
  [Family.EfdGo]: Jurisdiction.Goias,
  [Family.TabelasGo]: Jurisdiction.Goias,
  [Family.RcteAnexos]: Jurisdiction.Goias,
} as const satisfies Record<Family, Jurisdiction>

export function isFamily(value: unknown): value is Family {
  return typeof value === 'string' && (FAMILIES as readonly string[]).includes(value)
}

export function jurisdictionOf(family: Family): Jurisdiction {
  return FAMILY_JURISDICTION[family]
}

/**
 * Base da vigência de uma versão de dispositivo (`provision_versions.validity_basis`):
 * - `legal_effect`: efeito jurídico do ato (RCTE, CTE, NTs);
 * - `leiaute_period`: período de leiaute do Ato COTEPE (Guia Prático, REINF);
 * - `publication_approx`: data de publicação, aproximação (Guia EFD-GO);
 * - `table_declared`: datas declaradas na própria tabela (Tabelas GO), que não são vigência jurídica.
 */
export const ValidityBasis = {
  LegalEffect: 'legal_effect',
  LeiautePeriod: 'leiaute_period',
  PublicationApprox: 'publication_approx',
  TableDeclared: 'table_declared',
} as const
export type ValidityBasis = (typeof ValidityBasis)[keyof typeof ValidityBasis]

/** Obrigatoriedade da versão (`optional` só em NTs com período facultativo). */
export const Modality = {
  Mandatory: 'mandatory',
  Optional: 'optional',
} as const
export type Modality = (typeof Modality)[keyof typeof Modality]

/**
 * Estado de revisão da versão. A produção busca só `auto` e `approved`; o staging inclui
 * `pending` (anomalias da `review_queue`). `rejected` nunca é buscada.
 */
export const ReviewStatus = {
  Auto: 'auto',
  Approved: 'approved',
  Pending: 'pending',
  Rejected: 'rejected',
} as const
export type ReviewStatus = (typeof ReviewStatus)[keyof typeof ReviewStatus]

export const PUBLISHABLE_REVIEW_STATUSES: readonly ReviewStatus[] = [
  ReviewStatus.Auto,
  ReviewStatus.Approved,
]

/** Tipo de alteração registrada em `corpus.amendments.change_kind`. */
export const ChangeKind = {
  Original: 'original',
  Acrescimo: 'acrescimo',
  NovaRedacao: 'nova_redacao',
  Revogacao: 'revogacao',
  Renumeracao: 'renumeracao',
  Prorrogacao: 'prorrogacao',
} as const
export type ChangeKind = (typeof ChangeKind)[keyof typeof ChangeKind]
