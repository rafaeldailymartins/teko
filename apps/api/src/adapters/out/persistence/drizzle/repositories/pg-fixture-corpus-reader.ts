import {
  fromPostgresMultirange,
  fromPostgresRange,
  type ValidityInterval,
} from '@teko/shared/vigencia'
import { sql } from 'drizzle-orm'
import type { Family } from '#domain/corpus/family.ts'
import type { DrizzleDb } from '../client.ts'
import { CorpusInvariantError } from './corpus-invariant-error.ts'

/**
 * Leitura do corpus publicado no formato da fixture única (`seed-fixtures/fixture-schema.ts`),
 * para o `cli eval-fixture export` (porta `FixtureCorpusReader`). Só leitura: serve o role
 * `teko_app` ou o owner.
 *
 * Cada documento volta com todas as versões de documento `published` e, dos dispositivos pedidos,
 * as redações publicáveis (`auto`/`approved`) com conhecimento aberto. Campos derivados (o banco
 * não guarda o original):
 * - `versions[].key` = `v<published_on>-<8 primeiros hex do sha256>` (a fixture curada usa chaves
 *   livres, como `rcte-2026-09-16`); as `documentVersions` das redações usam a mesma chave;
 * - `headingPath` vem do chunk de ordinal 0 da redação mais recente do dispositivo;
 * - `knowledge` só aparece quando difere do padrão do seed (`[published_on da primeira versão
 *   citada, ∞)`); `parent`, `structured` e `amendment` são omitidos quando nulos;
 * - `amendment.effectiveFrom` = início de `amendments.effective`;
 * - dispositivo sem redação publicável aberta fica de fora (o schema exige ao menos uma);
 * - `coverage.gaps[].reason`: o banco guarda um `gap_reason` só, com os motivos unidos por `; `
 *   (como o seed grava); se a contagem não bater, o motivo inteiro vai para cada lacuna.
 */

interface FixtureSelectionInput {
  readonly slug: string
  readonly stableKeys: readonly string[]
}

interface ExportedVersion {
  readonly displayLabel: string
  readonly validDuring: ValidityInterval
  readonly knowledge?: ValidityInterval
  readonly modality: string
  readonly validityBasis: string
  readonly retroactive: boolean
  readonly reviewStatus: string
  readonly text: string
  readonly structured?: Readonly<Record<string, unknown>>
  readonly amendment?: {
    readonly actLabel: string
    readonly actKind: string
    readonly actDate: string
    readonly effectiveFrom: string
    readonly changeKind: string
    readonly rawNote: string
  }
  readonly documentVersions: readonly string[]
}

interface ExportedDocument {
  readonly slug: string
  readonly family: string
  readonly title: string
  readonly issuer: string
  readonly sourceUrl: string
  readonly versions: readonly {
    readonly key: string
    readonly versionLabel: string
    readonly publishedOn: string
    readonly validDuring: ValidityInterval
    readonly consolidatedUntil: string | null
    readonly actRef: string | null
    readonly sha256: string
  }[]
  readonly provisions: readonly {
    readonly stableKey: string
    readonly kind: string
    readonly parent?: string
    readonly sortPath: string
    readonly headingPath: string
    readonly versions: readonly ExportedVersion[]
  }[]
}

interface ExportedCoverage {
  readonly family: string
  readonly covered: readonly ValidityInterval[]
  readonly verifiedAt: string
  readonly gaps: readonly { readonly interval: ValidityInterval; readonly reason: string }[]
}

export interface PgFixtureCorpusReader {
  readDocuments(selection: readonly FixtureSelectionInput[]): Promise<ExportedDocument[]>
  readCoverage(families: readonly Family[]): Promise<ExportedCoverage[]>
}

interface DocumentRow {
  readonly id: string
  readonly slug: string
  readonly family: string
  readonly title: string
  readonly issuer: string
  readonly source_url: string
}

interface VersionRow {
  readonly id: string
  readonly document_id: string
  readonly version_label: string
  readonly published_on: string
  readonly valid_during: string
  readonly consolidated_until: string | null
  readonly act_ref: string | null
  readonly sha256: string
}

interface ProvisionRow {
  readonly id: string
  readonly document_id: string
  readonly stable_key: string
  readonly kind: string
  readonly parent: string | null
  readonly sort_path: string
}

interface ProvisionVersionRow {
  readonly provision_id: string
  readonly display_label: string
  readonly valid_during: string
  readonly knowledge: string
  readonly modality: string
  readonly validity_basis: string
  readonly retroactive: boolean
  readonly review_status: string
  readonly text: string
  readonly structured: Readonly<Record<string, unknown>> | null
  readonly act_label: string | null
  readonly act_kind: string | null
  readonly act_date: string | null
  readonly effective_from: string | null
  readonly change_kind: string | null
  readonly raw_note: string | null
  readonly heading_path: string | null
  readonly sources: readonly string[]
}

interface CoverageRow {
  readonly family: string
  readonly covered: string
  readonly verified_at: string
  readonly gaps: string
  readonly gap_reason: string | null
}

function range(text: string): ValidityInterval {
  const interval = fromPostgresRange(text)
  if (interval === null) {
    throw new CorpusInvariantError(`daterange vazio vindo do banco: ${text}`)
  }
  return interval
}

function versionKey(publishedOn: string, sha256: string): string {
  return `v${publishedOn}-${sha256.slice(0, 8)}`
}

function exportVersion(
  row: ProvisionVersionRow,
  keyOf: ReadonlyMap<string, { readonly key: string; readonly publishedOn: string }>,
): ExportedVersion {
  const cited = row.sources
    .map((id) => keyOf.get(id))
    .filter((entry) => entry !== undefined)
    .sort((a, b) => (a.publishedOn < b.publishedOn ? -1 : Number(a.publishedOn > b.publishedOn)))
  const knowledge = range(row.knowledge)
  const defaultFrom = cited[0]?.publishedOn
  const amendment =
    row.act_label === null ||
    row.act_kind === null ||
    row.act_date === null ||
    row.effective_from === null ||
    row.change_kind === null ||
    row.raw_note === null
      ? undefined
      : {
          actLabel: row.act_label,
          actKind: row.act_kind,
          actDate: row.act_date,
          effectiveFrom: row.effective_from,
          changeKind: row.change_kind,
          rawNote: row.raw_note,
        }
  return {
    displayLabel: row.display_label,
    validDuring: range(row.valid_during),
    ...(knowledge.from === defaultFrom && knowledge.to === null ? {} : { knowledge }),
    modality: row.modality,
    validityBasis: row.validity_basis,
    retroactive: row.retroactive,
    reviewStatus: row.review_status,
    text: row.text,
    ...(row.structured === null ? {} : { structured: row.structured }),
    ...(amendment === undefined ? {} : { amendment }),
    documentVersions: cited.map((entry) => entry.key),
  }
}

function gapsOf(row: CoverageRow): ExportedCoverage['gaps'] {
  const intervals = fromPostgresMultirange(row.gaps)
  const reasons = row.gap_reason?.split('; ') ?? []
  return intervals.map((interval, index) => ({
    interval,
    reason: (reasons.length === intervals.length ? reasons[index] : row.gap_reason) ?? 'sem motivo',
  }))
}

/** Tira o `parent` que não ficou no documento (pai sem redação publicável aberta). */
function withKnownParents(document: ExportedDocument): ExportedDocument {
  const kept = new Set(document.provisions.map((provision) => provision.stableKey))
  return {
    ...document,
    provisions: document.provisions.map(({ parent, ...provision }) =>
      parent === undefined || !kept.has(parent) ? provision : { ...provision, parent },
    ),
  }
}

export function createPgFixtureCorpusReader(db: DrizzleDb): PgFixtureCorpusReader {
  return {
    async readDocuments(selection) {
      if (selection.length === 0) {
        return []
      }
      const slugs = selection.map((entry) => entry.slug)
      const pairs = selection.flatMap((entry) =>
        entry.stableKeys.map((key) => ({ slug: entry.slug, key })),
      )
      const documents = await db.execute<DocumentRow>(sql`
        SELECT id, slug, family, title, issuer, source_url FROM corpus.documents
        WHERE slug = ANY(${sql.param(slugs)}::text[]) ORDER BY slug`)
      const documentIds = documents.rows.map((row) => row.id)
      const versions = await db.execute<VersionRow>(sql`
        SELECT id, document_id, version_label, published_on::text AS published_on,
               valid_during::text AS valid_during, consolidated_until, act_ref, sha256
        FROM corpus.document_versions
        WHERE document_id = ANY(${sql.param(documentIds)}::uuid[]) AND status = 'published'
        ORDER BY published_on, sha256`)
      const provisions = await db.execute<ProvisionRow>(sql`
        SELECT p.id, p.document_id, p.stable_key, p.kind, pp.stable_key AS parent, p.sort_path
        FROM corpus.provisions p
        JOIN corpus.documents d ON d.id = p.document_id
        JOIN unnest(${sql.param(pairs.map((pair) => pair.slug))}::text[],
                    ${sql.param(pairs.map((pair) => pair.key))}::text[]) AS s(slug, key)
          ON s.slug = d.slug AND s.key = p.stable_key
        LEFT JOIN corpus.provisions pp ON pp.id = p.parent_id
        ORDER BY p.sort_path, p.stable_key`)
      const provisionVersions = await db.execute<ProvisionVersionRow>(sql`
        SELECT pv.provision_id, pv.display_label, pv.valid_during::text AS valid_during,
               pv.knowledge::text AS knowledge, pv.modality, pv.validity_basis, pv.retroactive,
               pv.review_status, pv.text, pv.structured,
               a.act_label, a.act_kind, a.act_date::text AS act_date,
               lower(a.effective)::text AS effective_from, a.change_kind, a.raw_note,
               (SELECT c.heading_path FROM corpus.chunks c
                WHERE c.provision_version_id = pv.id ORDER BY c.ordinal LIMIT 1) AS heading_path,
               ARRAY(SELECT DISTINCT s.document_version_id::text FROM corpus.chunks c
                     JOIN corpus.chunk_sources s ON s.chunk_id = c.id
                     WHERE c.provision_version_id = pv.id) AS sources
        FROM corpus.provision_versions pv
        LEFT JOIN corpus.amendments a ON a.id = pv.amendment_id
        WHERE pv.provision_id = ANY(${sql.param(provisions.rows.map((row) => row.id))}::uuid[])
          AND upper_inf(pv.knowledge) AND pv.review_status IN ('auto', 'approved')
        ORDER BY lower(pv.valid_during), lower(pv.knowledge), pv.id`)

      const keyOf = new Map(
        versions.rows.map((row) => [
          row.id,
          { key: versionKey(row.published_on, row.sha256), publishedOn: row.published_on },
        ]),
      )
      const versionsOf = Map.groupBy(provisionVersions.rows, (row) => row.provision_id)
      return documents.rows.map((document) =>
        withKnownParents({
          slug: document.slug,
          family: document.family,
          title: document.title,
          issuer: document.issuer,
          sourceUrl: document.source_url,
          versions: versions.rows
            .filter((row) => row.document_id === document.id)
            .map((row) => ({
              key: versionKey(row.published_on, row.sha256),
              versionLabel: row.version_label,
              publishedOn: row.published_on,
              validDuring: range(row.valid_during),
              consolidatedUntil: row.consolidated_until,
              actRef: row.act_ref,
              sha256: row.sha256,
            })),
          provisions: provisions.rows
            .filter((row) => row.document_id === document.id)
            .flatMap((row) => {
              const rows = versionsOf.get(row.id) ?? []
              const headingPath = rows.at(-1)?.heading_path
              if (rows.length === 0 || headingPath == null) {
                return []
              }
              return [
                {
                  stableKey: row.stable_key,
                  kind: row.kind,
                  ...(row.parent === null ? {} : { parent: row.parent }),
                  sortPath: row.sort_path,
                  headingPath,
                  versions: rows.map((version) => exportVersion(version, keyOf)),
                },
              ]
            }),
        }),
      )
    },

    async readCoverage(families) {
      const rows = await db.execute<CoverageRow>(sql`
        SELECT family, covered::text AS covered, verified_at::text AS verified_at,
               gaps::text AS gaps, gap_reason
        FROM corpus.coverage WHERE family = ANY(${sql.param([...families])}::text[])
        ORDER BY family`)
      return rows.rows.map((row) => ({
        family: row.family,
        covered: fromPostgresMultirange(row.covered),
        verifiedAt: row.verified_at,
        gaps: gapsOf(row),
      }))
    },
  }
}
