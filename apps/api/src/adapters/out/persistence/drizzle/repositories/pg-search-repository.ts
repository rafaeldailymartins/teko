import type pg from 'pg'
import type { SearchQuery, SearchRepository } from '#app/ports/search-repository.ts'
import type { Evidence } from '#domain/qa/evidence.ts'
import {
  HNSW_SETTINGS,
  HYBRID_SEARCH_SQL,
  LEXICAL_ONLY_SQL,
  toVectorLiteral,
} from '../sql/hybrid-search.ts'

/**
 * `SearchRepository` sobre o `pg`: transação curta com os `SET LOCAL` do HNSW e a instrução única
 * da busca híbrida. Roda como `teko_app` (só leitura no corpus) pelo pooler.
 */

interface SearchRow {
  readonly id: string
  readonly stable_key: string
  readonly family: string
  readonly content: string
  readonly citation_label: string
  readonly valid_from: string
  readonly valid_to: string | null
  readonly version_label: string
  readonly doc_version_id: string
  readonly doc_title: string
  readonly source_url: string
  readonly rrf: number
  readonly lex_rank: string | null
  readonly sem_rank: string | null
  readonly ref_rank: string | null
}

const rank = (value: string | null): number | null => (value === null ? null : Number(value))

/** O `pg` devolve `date` como `Date` por padrão; a consulta usa `lower()`/`upper()` sobre daterange. */
function isoDate(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }
  return String(value)
}

export function toEvidence(row: SearchRow): Evidence {
  return Object.freeze({
    chunkId: row.id,
    stableKey: row.stable_key,
    family: row.family,
    citationLabel: row.citation_label,
    content: row.content,
    validity: Object.freeze({
      from: isoDate(row.valid_from),
      to: row.valid_to === null ? null : isoDate(row.valid_to),
    }),
    document: Object.freeze({
      versionId: row.doc_version_id,
      versionLabel: row.version_label,
      title: row.doc_title,
      sourceUrl: row.source_url,
    }),
    rrf: Number(row.rrf),
    lexicalRank: rank(row.lex_rank),
    semanticRank: rank(row.sem_rank),
    referenceRank: rank(row.ref_rank),
  })
}

export function searchParameters(query: SearchQuery): unknown[] {
  return [
    query.text,
    query.embedding === null ? null : toVectorLiteral(query.embedding),
    query.referenceDate,
    query.families,
    query.stableKeys,
    query.reviewStatuses,
    query.limit,
  ]
}

export function createPgSearchRepository(pool: pg.Pool): SearchRepository {
  return {
    async search(query) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN READ ONLY')
        if (query.embedding !== null) {
          for (const statement of HNSW_SETTINGS) {
            await client.query(statement)
          }
        }
        const result = await client.query<SearchRow>(
          query.embedding === null ? LEXICAL_ONLY_SQL : HYBRID_SEARCH_SQL,
          searchParameters(query),
        )
        await client.query('COMMIT')
        return result.rows.map(toEvidence)
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      } finally {
        client.release()
      }
    },
  }
}
