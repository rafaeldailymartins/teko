import type { Jurisdiction } from '@teko/shared/contracts'
import type pg from 'pg'
import type {
  ProvisionHistory,
  ProvisionMatch,
  ProvisionRepository,
} from '#app/ports/provision-repository.ts'
import { retryTransientRead } from '../client.ts'

/**
 * `ProvisionRepository` sobre o `pg`, só leitura (`teko_app`). A paleta junta dois caminhos:
 *
 * 1. chave ou rótulo contendo o texto (`ILIKE`, com `%` e `_` escapados): "art. 76", "C170";
 * 2. texto do chunk pelo `tsv` (`websearch_to_tsquery`, sem acento), que já tem índice GIN.
 *
 * Os casamentos por chave ou rótulo vêm antes; dentro de cada grupo, a nota do FTS e o
 * `sort_path`. Um resultado por redação. O rótulo exibido é o histórico da data
 * (`provision_labels`), ou o da redação.
 */

/** Escapa `%`, `_` e a própria barra para um padrão `ILIKE … ESCAPE '\'`. */
function likePattern(text: string): string {
  return `%${text.replaceAll(/[\\%_]/g, (char) => `\\${char}`)}%`
}

const SEARCH_PROVISIONS_SQL = `WITH q AS MATERIALIZED (
  SELECT websearch_to_tsquery('pg_catalog.portuguese', public.immutable_unaccent($2::text)) AS tsq),
hits AS (
  SELECT pv.id AS pv_id, 0 AS tier, 0::real AS score
  FROM corpus.provisions p
  JOIN corpus.documents d ON d.id = p.document_id
  JOIN corpus.provision_versions pv ON pv.provision_id = p.id
  WHERE (p.stable_key ILIKE $1 ESCAPE '\\' OR pv.display_label ILIKE $1 ESCAPE '\\')
    AND pv.valid_during @> $3::date AND upper_inf(pv.knowledge)
    AND pv.review_status = ANY($5::text[]) AND ($4::text IS NULL OR d.family = $4::text)
  UNION ALL
  SELECT c.provision_version_id, 1, ts_rank(c.tsv, q.tsq, 1 | 32)
  FROM corpus.chunks c, q
  WHERE c.tsv @@ q.tsq AND c.valid_during @> $3::date AND upper_inf(c.knowledge)
    AND c.review_status = ANY($5::text[]) AND ($4::text IS NULL OR c.family = $4::text)),
best AS (
  SELECT pv_id, min(tier) AS tier, max(score) AS score FROM hits GROUP BY pv_id)
SELECT p.stable_key, d.family, d.jurisdiction,
       coalesce((SELECT l.label FROM corpus.provision_labels l
                 WHERE l.provision_id = p.id AND l.valid_during @> $3::date
                 ORDER BY lower(l.valid_during) DESC LIMIT 1), pv.display_label) AS label,
       lower(pv.valid_during)::text AS valid_from, upper(pv.valid_during)::text AS valid_to,
       pv.text
FROM best b
JOIN corpus.provision_versions pv ON pv.id = b.pv_id
JOIN corpus.provisions p ON p.id = pv.provision_id
JOIN corpus.documents d ON d.id = p.document_id
ORDER BY b.tier, b.score DESC, p.sort_path, p.stable_key
LIMIT $6::int`

const PROVISION_HISTORY_SQL = `SELECT p.stable_key, d.family, d.jurisdiction,
       pv.display_label AS label, lower(pv.valid_during)::text AS valid_from,
       upper(pv.valid_during)::text AS valid_to, pv.text, a.act_label, pv.structured
FROM corpus.provisions p
JOIN corpus.documents d ON d.id = p.document_id
JOIN corpus.provision_versions pv ON pv.provision_id = p.id
LEFT JOIN corpus.amendments a ON a.id = pv.amendment_id
WHERE p.stable_key = $1::text AND upper_inf(pv.knowledge) AND pv.review_status = ANY($2::text[])
ORDER BY lower(pv.valid_during), pv.id`

interface BaseRow {
  readonly stable_key: string
  readonly family: string
  readonly jurisdiction: string
  readonly label: string
  readonly valid_from: string
  readonly valid_to: string | null
  readonly text: string
}

interface HistoryRow extends BaseRow {
  readonly act_label: string | null
  readonly structured: Readonly<Record<string, unknown>> | null
}

const jurisdictionOf = (value: string): Jurisdiction => (value === 'BR' ? 'BR' : 'GO')

function toMatch(row: BaseRow): ProvisionMatch {
  return {
    stableKey: row.stable_key,
    label: row.label,
    family: row.family,
    jurisdiction: jurisdictionOf(row.jurisdiction),
    validity: { from: row.valid_from, to: row.valid_to },
    text: row.text,
  }
}

function toHistory(rows: readonly HistoryRow[]): ProvisionHistory | null {
  const first = rows[0]
  if (first === undefined) {
    return null
  }
  return {
    stableKey: first.stable_key,
    family: first.family,
    jurisdiction: jurisdictionOf(first.jurisdiction),
    versions: rows.map((row) => ({
      label: row.label,
      validity: { from: row.valid_from, to: row.valid_to },
      text: row.text,
      act: row.act_label,
      structured: row.structured,
    })),
  }
}

export function createPgProvisionRepository(pool: pg.Pool): ProvisionRepository {
  return {
    async search(query) {
      const { rows } = await retryTransientRead(() =>
        pool.query<BaseRow>(SEARCH_PROVISIONS_SQL, [
          likePattern(query.text),
          query.text,
          query.at,
          query.family,
          query.reviewStatuses,
          query.limit,
        ]),
      )
      return rows.map(toMatch)
    },
    async history(stableKey, reviewStatuses) {
      const { rows } = await retryTransientRead(() =>
        pool.query<HistoryRow>(PROVISION_HISTORY_SQL, [stableKey, reviewStatuses]),
      )
      return toHistory(rows)
    },
  }
}
