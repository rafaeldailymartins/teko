import type pg from 'pg'
import {
  type MigrationRef,
  SNAPSHOT_TABLES,
  type SnapshotReader,
  type SnapshotRepository,
  type SnapshotRow,
  type SnapshotTable,
} from '#app/ports/snapshot-repository.ts'
import { type CoverageGapEntry, mergeGapsForPromotion } from '#domain/corpus/coverage-gaps.ts'
import { CorpusInvariantError } from './corpus-invariant-error.ts'
import { gapColumns, storedGapEntries } from './coverage-gap-entries.ts'

/**
 * `SnapshotRepository` sobre o `pg` (owner, conexão direta), com SQL explícito: a exportação lê
 * cada tabela por cursor numa transação `REPEATABLE READ READ ONLY` (todas as tabelas no mesmo
 * instante), e a promoção carrega cada arquivo numa tabela temporária e aplica tudo com comandos
 * por conjunto, numa transação só.
 *
 * Formato das linhas: tipos sem JSON nativo (uuid, date, daterange, datemultirange, halfvec) vão
 * como o texto canônico do Postgres, que o `jsonb_to_recordset` converte de volta pela função de
 * entrada do tipo; o `halfvec` volta exatamente igual, sem recalcular embeddings.
 *
 * Identidade entre ambientes (ADR 0025): os IDs `uuidv7()` do staging viajam no snapshot. Na
 * promoção, `documents` (`slug`), `document_versions` (`sha256`), `provisions` (`stable_key`) e
 * `chunks` (`provision_version_id, ordinal`) são remapeados pela chave natural quando o destino já
 * tem a linha com outro ID; `amendments`, `provision_labels` e `provision_versions` são casados
 * pelo ID.
 */

const FETCH_ROWS = 1000

interface ColumnSpec {
  readonly name: string
  /** Tipo na tabela temporária e no `jsonb_to_recordset`. */
  readonly type: string
  /** Expressão da exportação (alias `t`), no lugar da coluna. */
  readonly exportAs?: string
}

interface TableSpec {
  readonly columns: readonly ColumnSpec[]
  /** `WHERE` da exportação (alias `t`). */
  readonly filter: string
  readonly orderBy: string
}

const col = (name: string, type = 'text'): ColumnSpec => ({ name, type })

/** Versões de documento exportáveis (as `ingesting`/`failed` nunca saem do staging). */
const EXPORTED_DOCUMENT_VERSION = `status IN ('published', 'superseded')`
const exportedDocument = (column: string) =>
  `EXISTS (SELECT 1 FROM corpus.document_versions dv WHERE dv.document_id = ${column} AND dv.${EXPORTED_DOCUMENT_VERSION})`
const exportedProvision = (column: string) =>
  `EXISTS (SELECT 1 FROM corpus.provisions p WHERE p.id = ${column} AND ${exportedDocument('p.document_id')})`
const PUBLISHABLE = `review_status IN ('auto', 'approved')`

const TABLES: Readonly<Record<SnapshotTable, TableSpec>> = {
  documents: {
    columns: [
      col('id', 'uuid'),
      col('slug'),
      col('family'),
      col('jurisdiction'),
      col('title'),
      col('issuer'),
      col('source_url'),
    ],
    filter: exportedDocument('t.id'),
    orderBy: 't.id',
  },
  document_versions: {
    columns: [
      col('id', 'uuid'),
      col('document_id', 'uuid'),
      col('version_label'),
      col('published_on', 'date'),
      col('valid_during', 'daterange'),
      col('consolidated_until'),
      col('act_ref'),
      col('sha256'),
      col('blob_raw'),
      col('blob_docling'),
      col('status'),
      // Snapshots anteriores ao ADR 0026 não têm a coluna: o promote usa 1 (ver o INSERT).
      col('parser_revision', 'integer'),
    ],
    filter: `t.${EXPORTED_DOCUMENT_VERSION}`,
    orderBy: 't.id',
  },
  amendments: {
    columns: [
      col('id', 'uuid'),
      col('act_label'),
      col('act_kind'),
      col('act_date', 'date'),
      col('effective', 'daterange'),
      col('change_kind'),
      col('raw_note'),
    ],
    filter: `EXISTS (SELECT 1 FROM corpus.provision_versions pv WHERE pv.amendment_id = t.id AND pv.${PUBLISHABLE} AND ${exportedProvision('pv.provision_id')})`,
    orderBy: 't.id',
  },
  provisions: {
    columns: [
      col('id', 'uuid'),
      col('stable_key'),
      col('document_id', 'uuid'),
      col('kind'),
      col('parent_id', 'uuid'),
      col('sort_path'),
    ],
    filter: exportedDocument('t.document_id'),
    orderBy: 't.id',
  },
  provision_labels: {
    columns: [
      col('id', 'uuid'),
      col('provision_id', 'uuid'),
      col('label'),
      col('valid_during', 'daterange'),
    ],
    filter: exportedProvision('t.provision_id'),
    orderBy: 't.id',
  },
  provision_versions: {
    columns: [
      col('id', 'uuid'),
      col('provision_id', 'uuid'),
      col('display_label'),
      col('valid_during', 'daterange'),
      col('knowledge', 'daterange'),
      col('modality'),
      col('validity_basis'),
      col('retroactive', 'boolean'),
      col('review_status'),
      col('text'),
      col('structured', 'jsonb'),
      col('amendment_id', 'uuid'),
      col('content_hash'),
    ],
    filter: `t.${PUBLISHABLE} AND ${exportedProvision('t.provision_id')}`,
    orderBy: 't.id',
  },
  chunks: {
    columns: [
      col('id', 'uuid'),
      col('provision_version_id', 'uuid'),
      col('ordinal', 'integer'),
      col('family'),
      col('jurisdiction'),
      col('citation_label'),
      col('heading_path'),
      col('content'),
      col('content_hash'),
      col('valid_during', 'daterange'),
      col('knowledge', 'daterange'),
      col('modality'),
      col('review_status'),
      col('corpus_version', 'integer'),
      // Só o vetor de chunk aberto viaja (a busca nunca lê conhecimento fechado).
      {
        ...col('embedding', 'halfvec(1024)'),
        exportAs: 'CASE WHEN upper_inf(t.knowledge) THEN t.embedding::text END',
      },
      col('embedding_model'),
    ],
    filter: `EXISTS (SELECT 1 FROM corpus.provision_versions pv WHERE pv.id = t.provision_version_id AND pv.${PUBLISHABLE} AND ${exportedProvision('pv.provision_id')})`,
    orderBy: 't.id',
  },
  chunk_sources: {
    columns: [col('chunk_id', 'uuid'), col('document_version_id', 'uuid')],
    filter: `EXISTS (SELECT 1 FROM corpus.document_versions dv WHERE dv.id = t.document_version_id AND dv.${EXPORTED_DOCUMENT_VERSION})
      AND EXISTS (SELECT 1 FROM corpus.chunks c JOIN corpus.provision_versions pv ON pv.id = c.provision_version_id
        WHERE c.id = t.chunk_id AND pv.${PUBLISHABLE} AND ${exportedProvision('pv.provision_id')})`,
    orderBy: 't.chunk_id, t.document_version_id',
  },
  coverage: {
    columns: [
      col('family'),
      col('jurisdiction'),
      col('covered', 'datemultirange'),
      col('verified_at', 'date'),
      col('corpus_version', 'integer'),
      col('gaps', 'datemultirange'),
      col('gap_reason'),
      // Snapshots anteriores às entradas de lacuna não têm a coluna: a promoção usa `gaps`.
      col('gap_entries', 'jsonb'),
    ],
    filter: 'true',
    orderBy: 't.family',
  },
  corpus_versions: {
    columns: [col('id', 'integer'), col('notes')],
    filter: 'true',
    orderBy: 't.id',
  },
}

/** Tipos que saem como texto (o `pg` converteria alguns em `Date` ou não teria parser). */
const AS_TEXT = new Set(['uuid', 'date', 'daterange', 'datemultirange', 'halfvec(1024)'])

function selectList(spec: TableSpec): string {
  return spec.columns
    .map((column) => {
      if (column.exportAs !== undefined) {
        return `${column.exportAs} AS ${column.name}`
      }
      return AS_TEXT.has(column.type)
        ? `t.${column.name}::text AS ${column.name}`
        : `t.${column.name}`
    })
    .join(', ')
}

function columnNames(spec: TableSpec, prefix = ''): string {
  return spec.columns.map((column) => `${prefix}${column.name}`).join(', ')
}

function recordsetDefinition(spec: TableSpec): string {
  return spec.columns.map((column) => `${column.name} ${column.type}`).join(', ')
}

const tempTable = (table: SnapshotTable) => `snap_${table}`

/** `SET col = excluded.col` para todas as colunas, menos as da chave. */
function updateAll(spec: TableSpec, except: readonly string[]): string {
  return spec.columns
    .filter((column) => !except.includes(column.name))
    .map((column) => `${column.name} = excluded.${column.name}`)
    .join(', ')
}

async function latestMigration(client: pg.ClientBase): Promise<MigrationRef | null> {
  try {
    const result = await client.query<{ hash: string; name: string | null }>(
      `SELECT hash, name FROM drizzle.__drizzle_migrations
       ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1`,
    )
    const row = result.rows[0]
    return row === undefined ? null : { hash: row.hash, name: row.name }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '42P01') {
      return null
    }
    throw error
  }
}

async function currentCorpusVersion(client: pg.ClientBase): Promise<number | null> {
  const result = await client.query<{ id: number | null }>(
    'SELECT max(id) AS id FROM corpus.corpus_versions',
  )
  return result.rows[0]?.id ?? null
}

async function withClient<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>) {
  const client = await pool.connect()
  try {
    return await work(client)
  } finally {
    client.release()
  }
}

async function inTransaction<T>(
  client: pg.ClientBase,
  begin: string,
  work: () => Promise<T>,
): Promise<T> {
  await client.query(begin)
  try {
    const result = await work()
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

async function* readTable(
  client: pg.ClientBase,
  table: SnapshotTable,
): AsyncGenerator<SnapshotRow[]> {
  const spec = TABLES[table]
  const cursor = `snap_cursor_${table}`
  await client.query(
    `DECLARE ${cursor} NO SCROLL CURSOR FOR
     SELECT ${selectList(spec)} FROM corpus.${table} t WHERE ${spec.filter} ORDER BY ${spec.orderBy}`,
  )
  try {
    for (;;) {
      const result = await client.query<SnapshotRow>(`FETCH ${String(FETCH_ROWS)} FROM ${cursor}`)
      if (result.rows.length === 0) {
        return
      }
      yield result.rows
    }
  } finally {
    await client.query(`CLOSE ${cursor}`)
  }
}

/** SQL de mescla, na ordem de FK, depois de carregar as tabelas temporárias (até `chunk_sources`). */
function mergeStatements(): readonly string[] {
  const t = TABLES
  return [
    // documents: chave natural `slug`.
    `CREATE TEMP TABLE map_documents ON COMMIT DROP AS
       SELECT s.id AS snap_id, coalesce(d.id, s.id) AS id
       FROM snap_documents s LEFT JOIN corpus.documents d ON d.slug = s.slug`,
    `INSERT INTO corpus.documents (${columnNames(t.documents)})
       SELECT m.id, ${columnNames(t.documents, 's.').replace('s.id, ', '')}
       FROM snap_documents s JOIN map_documents m ON m.snap_id = s.id
       ON CONFLICT (slug) DO UPDATE SET ${updateAll(t.documents, ['id', 'slug'])}`,
    // document_versions: chave natural `sha256`.
    `CREATE TEMP TABLE map_document_versions ON COMMIT DROP AS
       SELECT s.id AS snap_id, coalesce(dv.id, s.id) AS id
       FROM snap_document_versions s LEFT JOIN corpus.document_versions dv ON dv.sha256 = s.sha256`,
    `INSERT INTO corpus.document_versions (${columnNames(t.document_versions)})
       SELECT m.id, md.id, s.version_label, s.published_on, s.valid_during, s.consolidated_until,
              s.act_ref, s.sha256, s.blob_raw, s.blob_docling, s.status,
              coalesce(s.parser_revision, 1)
       FROM snap_document_versions s
       JOIN map_document_versions m ON m.snap_id = s.id
       JOIN map_documents md ON md.snap_id = s.document_id
       ON CONFLICT (sha256) DO UPDATE SET ${updateAll(t.document_versions, ['id', 'sha256'])}`,
    // amendments: pelo ID.
    `INSERT INTO corpus.amendments (${columnNames(t.amendments)})
       SELECT ${columnNames(t.amendments)} FROM snap_amendments
       ON CONFLICT (id) DO UPDATE SET ${updateAll(t.amendments, ['id'])}`,
    // provisions: chave natural `stable_key` (o pai é remapeado pelo mesmo mapa).
    `CREATE TEMP TABLE map_provisions ON COMMIT DROP AS
       SELECT s.id AS snap_id, coalesce(p.id, s.id) AS id
       FROM snap_provisions s LEFT JOIN corpus.provisions p ON p.stable_key = s.stable_key`,
    `INSERT INTO corpus.provisions (${columnNames(t.provisions)})
       SELECT m.id, s.stable_key, md.id, s.kind, mp.id, s.sort_path
       FROM snap_provisions s
       JOIN map_provisions m ON m.snap_id = s.id
       JOIN map_documents md ON md.snap_id = s.document_id
       LEFT JOIN map_provisions mp ON mp.snap_id = s.parent_id
       ON CONFLICT (stable_key) DO UPDATE SET ${updateAll(t.provisions, ['id', 'stable_key'])}`,
    // provision_labels: os rótulos dos dispositivos do snapshot são substituídos.
    `DELETE FROM corpus.provision_labels WHERE provision_id IN (SELECT id FROM map_provisions)`,
    `INSERT INTO corpus.provision_labels (${columnNames(t.provision_labels)})
       SELECT s.id, m.id, s.label, s.valid_during
       FROM snap_provision_labels s JOIN map_provisions m ON m.snap_id = s.provision_id
       ON CONFLICT (id) DO UPDATE SET ${updateAll(t.provision_labels, ['id'])}`,
    // provision_versions: ausentes do snapshot têm o conhecimento fechado; depois o upsert pelo ID,
    // primeiro as linhas fechadas no snapshot e só então as abertas (o pv_no_overlap é conferido
    // linha a linha).
    `UPDATE corpus.provision_versions
       SET knowledge = daterange(lower(knowledge), greatest($1::date, lower(knowledge) + 1))
       WHERE upper_inf(knowledge) AND id NOT IN (SELECT id FROM snap_provision_versions)`,
    ...['NOT upper_inf(s.knowledge)', 'upper_inf(s.knowledge)'].map(
      (pass) => `INSERT INTO corpus.provision_versions (${columnNames(t.provision_versions)})
       SELECT s.id, mp.id, s.display_label, s.valid_during, s.knowledge, s.modality,
              s.validity_basis, s.retroactive, s.review_status, s.text, s.structured,
              s.amendment_id, s.content_hash
       FROM snap_provision_versions s JOIN map_provisions mp ON mp.snap_id = s.provision_id
       WHERE ${pass}
       ON CONFLICT (id) DO UPDATE SET ${updateAll(t.provision_versions, ['id'])}`,
    ),
    // chunks: chave natural `(provision_version_id, ordinal)`.
    `CREATE TEMP TABLE map_chunks ON COMMIT DROP AS
       SELECT s.id AS snap_id, coalesce(c.id, s.id) AS id
       FROM snap_chunks s LEFT JOIN corpus.chunks c
         ON c.provision_version_id = s.provision_version_id AND c.ordinal = s.ordinal`,
    // Chunk fechado perde o vetor (a busca só lê conhecimento aberto; o snapshot também não o leva).
    `UPDATE corpus.chunks
       SET knowledge = daterange(lower(knowledge), greatest($1::date, lower(knowledge) + 1)),
         embedding = NULL
       WHERE upper_inf(knowledge) AND id NOT IN (SELECT id FROM map_chunks)`,
    `INSERT INTO corpus.chunks (${columnNames(t.chunks)})
       SELECT m.id, ${columnNames(t.chunks, 's.').replace('s.id, ', '')}
       FROM snap_chunks s JOIN map_chunks m ON m.snap_id = s.id
       ON CONFLICT (provision_version_id, ordinal) DO UPDATE SET ${updateAll(t.chunks, ['id', 'provision_version_id', 'ordinal'])}`,
    `INSERT INTO corpus.chunk_sources (chunk_id, document_version_id)
       SELECT mc.id, mdv.id FROM snap_chunk_sources s
       JOIN map_chunks mc ON mc.snap_id = s.chunk_id
       JOIN map_document_versions mdv ON mdv.snap_id = s.document_version_id
       ON CONFLICT DO NOTHING`,
  ]
}

/** corpus_versions por último, com a numeração do staging. */
const CORPUS_VERSION_STATEMENTS = [
  `INSERT INTO corpus.corpus_versions (id, notes)
     SELECT id, notes FROM snap_corpus_versions ON CONFLICT (id) DO NOTHING`,
  `SELECT setval(pg_get_serial_sequence('corpus.corpus_versions', 'id'),
     (SELECT max(id) FROM corpus.corpus_versions))`,
] as const

interface SnapCoverageRow {
  readonly family: string
  readonly gaps: string
  readonly gap_reason: string | null
  readonly gap_entries: unknown
}

/** Entradas de uma linha de cobertura (snapshot anterior a elas ou destino legado: `gaps`). */
function snapshotGapEntries(row: SnapCoverageRow): CoverageGapEntry[] {
  return storedGapEntries({
    family: row.family,
    gaps: row.gaps,
    gapReason: row.gap_reason,
    gapEntries: row.gap_entries,
  })
}

/**
 * coverage (A1): `covered` e a versão vêm do snapshot; `verified_at` é o maior dos dois (o
 * `mark-coverage` avança o da produção todo dia); as lacunas são as do snapshot mais as do destino
 * detectadas depois da exportação (`mergeGapsForPromotion`). Decidir pelo `verified_at` deixava a
 * produção com a lacuna para sempre: o dela avança todo dia e o do snapshot é o do dia da ingestão.
 */
async function mergeCoverage(client: pg.ClientBase, snapshotCreatedAt: string): Promise<void> {
  const snapshot = await client.query<SnapCoverageRow>(
    'SELECT family, gaps::text AS gaps, gap_reason, gap_entries FROM snap_coverage ORDER BY family',
  )
  const target = await client.query<SnapCoverageRow>(
    `SELECT family, gaps::text AS gaps, gap_reason, gap_entries FROM corpus.coverage
     WHERE family IN (SELECT family FROM snap_coverage) FOR UPDATE`,
  )
  const targetEntries = new Map(target.rows.map((row) => [row.family, snapshotGapEntries(row)]))
  for (const row of snapshot.rows) {
    const columns = gapColumns(
      mergeGapsForPromotion(
        snapshotGapEntries(row),
        targetEntries.get(row.family) ?? [],
        snapshotCreatedAt,
      ),
    )
    await client.query(
      `INSERT INTO corpus.coverage AS cov (family, jurisdiction, covered, verified_at,
         corpus_version, gaps, gap_reason, gap_entries)
       SELECT family, jurisdiction, covered, verified_at, corpus_version,
         $2::datemultirange, $3, $4::jsonb
       FROM snap_coverage WHERE family = $1
       ON CONFLICT (family) DO UPDATE SET jurisdiction = excluded.jurisdiction,
         covered = excluded.covered, corpus_version = excluded.corpus_version,
         verified_at = greatest(cov.verified_at, excluded.verified_at),
         gaps = excluded.gaps, gap_reason = excluded.gap_reason,
         gap_entries = excluded.gap_entries`,
      [row.family, columns.gaps, columns.gapReason, columns.gapEntries],
    )
  }
}

/** Mesma invariante da escrita: todo chunk publicável atual tem fonte publicada. */
async function assertPublishedSources(client: pg.ClientBase): Promise<void> {
  const result = await client.query<{ orphans: number }>(`
    SELECT count(*)::int AS orphans FROM corpus.chunks c
    WHERE upper_inf(c.knowledge) AND c.review_status IN ('auto', 'approved')
      AND NOT EXISTS (
        SELECT 1 FROM corpus.chunk_sources s
        JOIN corpus.document_versions dv ON dv.id = s.document_version_id
        WHERE s.chunk_id = c.id AND dv.status = 'published')`)
  const orphans = result.rows[0]?.orphans ?? 0
  if (orphans > 0) {
    throw new CorpusInvariantError(
      `${String(orphans)} chunk(s) publicável(is) sem fonte publicada depois da promoção`,
    )
  }
}

function countsByTable(count: (table: SnapshotTable) => number): Record<SnapshotTable, number> {
  return {
    documents: count('documents'),
    document_versions: count('document_versions'),
    amendments: count('amendments'),
    provisions: count('provisions'),
    provision_labels: count('provision_labels'),
    provision_versions: count('provision_versions'),
    chunks: count('chunks'),
    chunk_sources: count('chunk_sources'),
    coverage: count('coverage'),
    corpus_versions: count('corpus_versions'),
  }
}

export function createPgSnapshotRepository(pool: pg.Pool): SnapshotRepository {
  return {
    read: (work) =>
      withClient(pool, (client) =>
        inTransaction(client, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', async () => {
          const reader: SnapshotReader = {
            corpusVersion: await currentCorpusVersion(client),
            migration: await latestMigration(client),
            rows: (table) => readTable(client, table),
          }
          return work(reader)
        }),
      ),

    latestMigration: () => withClient(pool, latestMigration),

    migrationApplied: (hash) =>
      withClient(pool, async (client) => {
        const result = await client.query<{ found: boolean }>(
          'SELECT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1) AS found',
          [hash],
        )
        return result.rows[0]?.found === true
      }),

    currentCorpusVersion: () => withClient(pool, currentCorpusVersion),

    promote: ({ manifest, rows, today, rollbackNotes }) =>
      withClient(pool, (client) =>
        inTransaction(client, 'BEGIN', async () => {
          const counts: Partial<Record<SnapshotTable, number>> = {}
          for (const table of SNAPSHOT_TABLES) {
            const spec = TABLES[table]
            await client.query(
              `CREATE TEMP TABLE ${tempTable(table)} (${recordsetDefinition(spec)}) ON COMMIT DROP`,
            )
            let count = 0
            for await (const batch of rows(table)) {
              count += batch.length
              await client.query(
                `INSERT INTO ${tempTable(table)} (${columnNames(spec)})
                 SELECT ${columnNames(spec)} FROM jsonb_to_recordset($1::jsonb) AS r(${recordsetDefinition(spec)})`,
                [JSON.stringify(batch)],
              )
            }
            const expected = manifest.tables.find((entry) => entry.name === table)?.rows
            if (count !== expected) {
              throw new CorpusInvariantError(
                `${table}: ${String(count)} linhas no arquivo, ${String(expected)} no manifesto`,
              )
            }
            counts[table] = count
          }
          for (const statement of mergeStatements()) {
            await client.query(statement, statement.includes('$1') ? [today] : [])
          }
          await mergeCoverage(client, manifest.createdAt)
          for (const statement of CORPUS_VERSION_STATEMENTS) {
            await client.query(statement)
          }
          if (rollbackNotes !== undefined) {
            // Rollback: o conteúdo do snapshot antigo vira uma versão nova do corpus (a numeração
            // só cresce; o snapshot seguinte do staging precisa ser mais novo que ela).
            const created = await client.query<{ id: number }>(
              'INSERT INTO corpus.corpus_versions (notes) VALUES ($1) RETURNING id',
              [rollbackNotes],
            )
            await client.query(
              `UPDATE corpus.coverage SET corpus_version = $1
               WHERE family IN (SELECT family FROM snap_coverage)`,
              [created.rows[0]?.id],
            )
          }
          await assertPublishedSources(client)
          return countsByTable((table) => counts[table] ?? 0)
        }),
      ),
  }
}
