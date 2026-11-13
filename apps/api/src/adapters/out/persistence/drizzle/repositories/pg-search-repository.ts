import type pg from 'pg'
import type { SearchQuery, SearchRepository } from '#app/ports/search-repository.ts'
import type { Evidence } from '#domain/qa/evidence.ts'
import { isTransientConnectionError, retryTransientRead } from '../client.ts'
import {
  BEGIN_HYBRID_SEARCH,
  BEGIN_SEARCH,
  HYBRID_SEARCH_SQL,
  LEXICAL_ONLY_SQL,
  toVectorLiteral,
} from '../sql/hybrid-search.ts'

/**
 * `SearchRepository` sobre o `pg`: transação curta com os ajustes locais do HNSW e a instrução
 * única da busca híbrida, em três idas ao banco. Roda como `teko_app` (só leitura no corpus) pelo
 * pooler.
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

export function toEvidence(row: SearchRow): Evidence {
  return Object.freeze({
    chunkId: row.id,
    stableKey: row.stable_key,
    family: row.family,
    citationLabel: row.citation_label,
    content: row.content,
    validity: Object.freeze({
      // `::text` na consulta: a data chega como `AAAA-MM-DD`, sem passar por `Date` (fuso local).
      from: row.valid_from,
      to: row.valid_to,
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

async function searchOnce(pool: pg.Pool, query: SearchQuery): Promise<Evidence[]> {
  const client = await pool.connect()
  let failure: unknown
  try {
    // Uma ida ao banco para abrir a transação (com os ajustes do HNSW, no modo híbrido), uma
    // para a busca (instrução sem nome: nada de prepared statement nomeado no PgBouncer) e uma
    // para o COMMIT.
    await client.query(query.embedding === null ? BEGIN_SEARCH : BEGIN_HYBRID_SEARCH)
    const result = await client.query<SearchRow>(
      query.embedding === null ? LEXICAL_ONLY_SQL : HYBRID_SEARCH_SQL,
      searchParameters(query),
    )
    await client.query('COMMIT')
    return result.rows.map(toEvidence)
  } catch (error) {
    failure = error
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    // Conexão que caiu não volta ao pool: `release(erro)` a descarta.
    client.release(isTransientConnectionError(failure) ? (failure as Error) : undefined)
  }
}

export function createPgSearchRepository(pool: pg.Pool): SearchRepository {
  return {
    // Leitura idempotente (transação só leitura): um retry numa conexão nova se a primeira cair.
    search: (query) => retryTransientRead(() => searchOnce(pool, query)),
  }
}
