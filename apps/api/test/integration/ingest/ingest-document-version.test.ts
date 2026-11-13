import pg from 'pg'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSizeLimitError } from '#app/ports/database-usage.ts'
import { createTestDatabase, type TestDatabase } from '../../setup/database.ts'
import { createIngestionTestContext, type IngestionTestContext } from '../../setup/ingestion.ts'
import { article, guiaSource, interval, rcteSource, version } from './sources.ts'

/**
 * Ingestão incremental (DoD da F3), num banco vazio por teste, como owner:
 * - a segunda execução da mesma versão gera 0 linhas e 0 chamadas/neurons de embedding;
 * - retomada depois do `budget_exhausted`, sem reembutir o que já está no cache;
 * - anomalia `pending` sobreposta não bloqueia a publicação (1 item na fila);
 * - consolidado novo fecha o `knowledge` das redações sumidas e alarga as idênticas;
 * - Guia: versões consecutivas iguais viram uma linha; versão corretiva recorta a vigência;
 * - guarda de tamanho do banco.
 */

let database: TestDatabase
let owner: pg.Client
const contexts: IngestionTestContext[] = []

function context(options: Parameters<typeof createIngestionTestContext>[1] = {}) {
  const created = createIngestionTestContext(database.ownerUrl, options)
  contexts.push(created)
  return created
}

async function count(table: string, where = 'true'): Promise<number> {
  const { rows } = await owner.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM corpus.${table} WHERE ${where}`,
  )
  return rows[0]?.n ?? 0
}

async function snapshotCounts() {
  return {
    documentVersions: await count('document_versions'),
    provisionVersions: await count('provision_versions'),
    chunks: await count('chunks'),
    chunkSources: await count('chunk_sources'),
    reviewQueue: await count('review_queue'),
    cache: await count('embedding_cache'),
  }
}

beforeEach(async () => {
  database = await createTestDatabase()
  owner = new pg.Client({ connectionString: database.ownerUrl })
  await owner.connect()
}, 120_000)

afterEach(async () => {
  for (const created of contexts.splice(0)) {
    await created.container.close()
  }
  await owner?.end()
  await database?.drop()
})

afterAll(async () => {
  await database?.drop()
})

const V1 = rcteSource('dec-1', '2026-01-10', [
  article(901, [
    version('Art. 901. Texto original do artigo novecentos e um.', interval('2000-01-01')),
  ]),
  article(902, [
    version(
      'Art. 902. Redação antiga do artigo novecentos e dois.',
      interval('2000-01-01', '2010-01-01'),
    ),
    version('Art. 902. Redação nova do artigo novecentos e dois.', interval('2010-01-01')),
  ]),
  article(903, [
    version('Art. 903. Texto que voltará alargado.', interval('2005-01-01', '2020-01-01')),
    version('Art. 903. Texto que vai sumir da consolidação.', interval('2020-01-01')),
  ]),
  article(904, [version('Art. 904. Artigo que será removido.', interval('2001-01-01'))]),
])

describe('reingestão da mesma versão', () => {
  it('gera 0 linhas novas e não chama os embeddings', async () => {
    const { container, spy } = context()
    const { useCases } = container
    const first = await useCases.startIngestionRun({ target: 'staging', gitSha: 'a'.repeat(40) })
    const published = await useCases.ingestDocumentVersion({
      runId: first.runId,
      source: V1,
      blobRaw: 'rcte/rcte/dec-1/raw.htm',
      blobDocling: null,
      parserRevision: 1,
    })
    expect(published).toMatchObject({
      status: 'published',
      provisionVersionsNew: 6,
      reviewItems: 0,
    })
    await useCases.finishIngestionRun({ runId: first.runId, status: 'succeeded', report: {} })
    const after = await snapshotCounts()
    expect(after.provisionVersions).toBe(6)
    expect(spy.texts()).toBe(6)

    spy.reset()
    const second = await useCases.startIngestionRun({ target: 'staging', gitSha: 'b'.repeat(40) })
    const again = await useCases.ingestDocumentVersion({
      runId: second.runId,
      source: V1,
      blobRaw: null,
      blobDocling: null,
      parserRevision: 1,
    })
    await useCases.finishIngestionRun({ runId: second.runId, status: 'succeeded', report: {} })
    expect(again).toEqual({
      status: 'unchanged',
      documentVersionId: published.status === 'published' ? published.documentVersionId : '',
    })
    expect(await snapshotCounts()).toEqual(after)
    expect(spy.calls).toEqual([])
    const { rows } = await owner.query<{ neurons: number; docs: number; status: string }>(
      'SELECT neurons, docs, status FROM corpus.ingestion_runs WHERE id = $1',
      [second.runId],
    )
    expect(rows[0]).toEqual({ neurons: 0, docs: 0, status: 'succeeded' })
  })

  it('revisão maior do parser reprocessa a mesma versão: fecha só o que mudou (ADR 0026)', async () => {
    const { container, spy } = context()
    const { useCases } = container
    const first = await useCases.startIngestionRun({ target: 'staging', gitSha: 'a'.repeat(40) })
    const published = await useCases.ingestDocumentVersion({
      runId: first.runId,
      source: V1,
      blobRaw: null,
      blobDocling: null,
      parserRevision: 1,
    })
    await useCases.finishIngestionRun({ runId: first.runId, status: 'succeeded', report: {} })
    spy.reset()
    // Mesmo arquivo (mesmo sha256), saída corrigida do parser no art. 901; o resto igual.
    const corrected = rcteSource('dec-1', '2026-01-10', [
      article(901, [
        version('Art. 901. Texto corrigido pelo parser novo.', interval('2000-01-01')),
      ]),
      ...V1.provisions
        .filter((provision) => !provision.stableKey.endsWith(':art:901'))
        .map((provision) => ({ ...provision })),
    ])
    expect(corrected.version.sha256).toBe(V1.version.sha256)
    const second = await useCases.startIngestionRun({ target: 'staging', gitSha: 'b'.repeat(40) })
    const again = await useCases.ingestDocumentVersion({
      runId: second.runId,
      source: corrected,
      blobRaw: null,
      blobDocling: null,
      parserRevision: 2,
    })
    await useCases.finishIngestionRun({ runId: second.runId, status: 'succeeded', report: {} })
    expect(again).toMatchObject({
      status: 'published',
      reprocessed: true,
      documentVersionId: published.status === 'published' ? published.documentVersionId : '',
      provisionVersionsNew: 1,
      knowledgeClosed: 1,
    })
    // Só o texto corrigido foi embutido; uma versão de documento, agora com a revisão 2.
    expect(spy.texts()).toBe(1)
    const { rows } = await owner.query<{ n: number; rev: number }>(
      'SELECT count(*)::int AS n, max(parser_revision) AS rev FROM corpus.document_versions',
    )
    expect(rows[0]).toEqual({ n: 1, rev: 2 })
    expect(await count('provision_versions', 'upper_inf(knowledge)')).toBe(6)
    expect(await count('provision_versions', "text LIKE 'Art. 901. Texto corrigido%'")).toBe(1)
    // B4: a redação antiga fecha no dia seguinte e a corrigida começa nele (nunca duas
    // redações conhecidas no mesmo dia); o vetor da fechada sai.
    const knowledge = await owner.query<{ knowledge: string; embedding: boolean }>(
      `SELECT pv.knowledge::text AS knowledge, bool_and(c.embedding IS NOT NULL) AS embedding
       FROM corpus.provision_versions pv JOIN corpus.provisions p ON p.id = pv.provision_id
       JOIN corpus.chunks c ON c.provision_version_id = pv.id
       WHERE p.stable_key = 'go:rcte:art:901' GROUP BY pv.id ORDER BY lower(pv.knowledge)`,
    )
    expect(knowledge.rows).toEqual([
      { knowledge: '[2026-01-10,2026-01-11)', embedding: false },
      { knowledge: '[2026-01-11,)', embedding: true },
    ])
    // O mesmo arquivo com a revisão antiga (ramo desatualizado) não desfaz a correção.
    const stale = await useCases.ingestDocumentVersion({
      runId: second.runId,
      source: V1,
      blobRaw: null,
      blobDocling: null,
      parserRevision: 1,
    })
    expect(stale.status).toBe('unchanged')
  })

  it('revisão maior com só o título corrigido troca a redação e os chunks daquele dispositivo', async () => {
    const { container, spy } = context()
    const { useCases } = container
    const first = await useCases.startIngestionRun({ target: 'staging', gitSha: 'a'.repeat(40) })
    await useCases.ingestDocumentVersion({
      runId: first.runId,
      source: V1,
      blobRaw: null,
      blobDocling: null,
      parserRevision: 1,
    })
    await useCases.finishIngestionRun({ runId: first.runId, status: 'succeeded', report: {} })
    spy.reset()
    // Mesmo texto e vigência no art. 901; só o título mudou (capítulo acrescido reconhecido).
    const retitled = rcteSource(
      'dec-1',
      '2026-01-10',
      V1.provisions.map((provision) =>
        provision.stableKey.endsWith(':art:901')
          ? { ...provision, headingPath: 'RCTE > CAPÍTULO IV-A - DA EFD > Art. 901' }
          : provision,
      ),
    )
    const second = await useCases.startIngestionRun({ target: 'staging', gitSha: 'b'.repeat(40) })
    const again = await useCases.ingestDocumentVersion({
      runId: second.runId,
      source: retitled,
      blobRaw: null,
      blobDocling: null,
      parserRevision: 2,
    })
    await useCases.finishIngestionRun({ runId: second.runId, status: 'succeeded', report: {} })
    expect(again).toMatchObject({
      status: 'published',
      reprocessed: true,
      provisionVersionsNew: 1,
      knowledgeClosed: 1,
    })
    // O texto do embedding leva o título: só o chunk do art. 901 é embutido de novo.
    expect(spy.texts()).toBe(1)
    const { rows } = await owner.query<{ heading_path: string }>(
      `SELECT c.heading_path FROM corpus.chunks c
       JOIN corpus.provision_versions pv ON pv.id = c.provision_version_id
       JOIN corpus.provisions p ON p.id = pv.provision_id
       WHERE p.stable_key = 'go:rcte:art:901' AND upper_inf(pv.knowledge)`,
    )
    expect(rows).toEqual([{ heading_path: 'RCTE > CAPÍTULO IV-A - DA EFD > Art. 901' }])
    expect(await count('provision_versions', 'upper_inf(knowledge)')).toBe(6)
  })

  it('outro sha256 com o mesmo conteúdo reaproveita as linhas e só acrescenta fontes', async () => {
    const { container, spy } = context()
    const { runId } = await container.useCases.startIngestionRun({ target: 'staging', gitSha: 'c' })
    await container.useCases.ingestDocumentVersion({
      runId,
      source: V1,
      blobRaw: null,
      blobDocling: null,
      parserRevision: 1,
    })
    spy.reset()
    const redownload = rcteSource('dec-1-redownload', '2026-01-10', V1.provisions)
    const result = await container.useCases.ingestDocumentVersion({
      runId,
      source: redownload,
      blobRaw: null,
      blobDocling: null,
      parserRevision: 1,
    })
    expect(result).toMatchObject({
      status: 'published',
      provisionVersionsNew: 0,
      provisionVersionsWidened: 0,
      knowledgeClosed: 0,
      chunksNew: 0,
      neurons: 0,
    })
    expect(spy.calls).toEqual([])
    expect(await count('provision_versions')).toBe(6)
    expect(await count('chunk_sources')).toBe(12)

    // A5: a mesma página regravada (sha256 novo, mesmo rótulo e conteúdo) não vira versão.
    const before = await snapshotCounts()
    const rewritten = {
      ...redownload,
      version: { ...redownload.version, sha256: 'f'.repeat(64) },
    }
    const again = await container.useCases.ingestDocumentVersion({
      runId,
      source: rewritten,
      blobRaw: null,
      blobDocling: null,
      parserRevision: 1,
    })
    expect(again).toMatchObject({ status: 'unchanged', reason: 'fingerprint' })
    expect(await snapshotCounts()).toEqual(before)
  })
})

describe('orçamento de neurons', () => {
  it('para com budget_exhausted sem publicar e o run seguinte retoma pelo cache', async () => {
    const batchLimits = { maxItems: 2, maxPaddedTokens: 48_000 }
    const low = context({ budget: 1, neuronsPerCall: 1, batchLimits })
    const first = await low.container.useCases.startIngestionRun({ target: 'staging', gitSha: 'd' })
    const stopped = await low.container.useCases.ingestDocumentVersion({
      runId: first.runId,
      source: V1,
      blobRaw: null,
      blobDocling: null,
      parserRevision: 1,
    })
    expect(stopped).toEqual({
      status: 'budget_exhausted',
      neurons: 1,
      embeddedChunks: 2,
      pendingChunks: 4,
    })
    await low.container.useCases.finishIngestionRun({
      runId: first.runId,
      status: 'budget_exhausted',
      report: {},
    })
    expect(await count('document_versions')).toBe(0)
    expect(await count('provision_versions')).toBe(0)
    expect(await count('embedding_cache')).toBe(2)
    const embeddedBefore = new Set(low.spy.calls.flat())

    const high = context({ budget: 100, neuronsPerCall: 1, batchLimits })
    const second = await high.container.useCases.startIngestionRun({
      target: 'staging',
      gitSha: 'e',
    })
    const resumed = await high.container.useCases.ingestDocumentVersion({
      runId: second.runId,
      source: V1,
      blobRaw: null,
      blobDocling: null,
      parserRevision: 1,
    })
    expect(resumed).toMatchObject({ status: 'published', provisionVersionsNew: 6, neurons: 2 })
    expect(high.spy.texts()).toBe(4)
    for (const text of high.spy.calls.flat()) {
      expect(embeddedBefore.has(text)).toBe(false)
    }
    expect(await count('chunks', 'embedding IS NULL')).toBe(0)
    expect(await high.container.neuronBudget.remaining()).toBe(97)
  })
})

describe('anomalias', () => {
  it('uma redação pending sobreposta não bloqueia a publicação e abre 1 item na fila', async () => {
    const { container } = context()
    const anomaly = rcteSource('dec-anomalia', '2026-02-01', [
      article(910, [
        version('Art. 910. Redação de 2000.', interval('2000-01-01', '2010-01-01')),
        version('Art. 910. Redação de 2010.', interval('2010-01-01')),
        version(
          'Art. 910. Redação com nota de vigência ilegível.',
          interval('2005-01-01', '2012-01-01'),
          {
            review: { reason: 'note-unparsed', rawNote: 'Redação com vigência de 01.01.05 a ??' },
          },
        ),
      ]),
      article(911, [version('Art. 911. Outro artigo do documento.', interval('2000-01-01'))]),
    ])
    const { runId } = await container.useCases.startIngestionRun({ target: 'staging', gitSha: 'f' })
    const result = await container.useCases.ingestDocumentVersion({
      runId,
      source: anomaly,
      blobRaw: null,
      blobDocling: null,
      parserRevision: 1,
    })
    expect(result).toMatchObject({ status: 'published', provisionVersionsNew: 4, reviewItems: 1 })
    expect(await count('provision_versions', `review_status = 'pending'`)).toBe(1)
    const { rows } = await owner.query<{ stable_key: string; reason: string; proposed: string }>(
      'SELECT stable_key, reason, proposed::text AS proposed FROM corpus.review_queue',
    )
    expect(rows).toEqual([
      {
        stable_key: 'go:rcte:art:910',
        reason: 'note-unparsed',
        proposed: '[2005-01-01,2012-01-01)',
      },
    ])

    // Reingestão (outro download, mesmo conteúdo): a anomalia é reaproveitada, sem item novo.
    const again = await container.useCases.ingestDocumentVersion({
      runId,
      source: rcteSource('dec-anomalia-2', '2026-02-01', anomaly.provisions),
      blobRaw: null,
      blobDocling: null,
      parserRevision: 1,
    })
    expect(again).toMatchObject({ status: 'published', provisionVersionsNew: 0, reviewItems: 0 })
    expect(await count('review_queue')).toBe(1)

    // O relatório do load mostra a fila por família e motivo e o estado para o gate de saúde.
    const inspect = container.useCases.inspectCorpus
    expect(await inspect.openReviewQueue()).toEqual([
      { family: 'rcte', reason: 'note-unparsed', open: 1 },
    ])
    expect(await inspect.documentHealth()).toEqual([
      { slug: 'rcte', family: 'rcte', provisions: 2, chunks: 3, pending: 1, versions: 4 },
    ])
  })
})

describe('reconciliação de um consolidado novo', () => {
  it('fecha o knowledge das redações sumidas, alarga as idênticas e fecha o snapshot anterior', async () => {
    const { container } = context()
    const { runId } = await container.useCases.startIngestionRun({ target: 'staging', gitSha: 'g' })
    const first = await container.useCases.ingestDocumentVersion({
      runId,
      source: V1,
      blobRaw: null,
      blobDocling: null,
      parserRevision: 1,
    })
    const v2 = rcteSource('dec-2', '2026-06-01', [
      article(901, [
        version('Art. 901. Texto original do artigo novecentos e um.', interval('2000-01-01')),
      ]),
      article(902, [
        version(
          'Art. 902. Redação antiga do artigo novecentos e dois.',
          interval('2000-01-01', '2010-01-01'),
        ),
        version(
          'Art. 902. Redação nova do artigo novecentos e dois.',
          interval('2010-01-01', '2026-05-01'),
        ),
        version('Art. 902. Redação de 2026 do artigo novecentos e dois.', interval('2026-05-01')),
      ]),
      article(903, [version('Art. 903. Texto que voltará alargado.', interval('2005-01-01'))]),
    ])
    const ids = async (key: string) =>
      (
        await owner.query<{ id: string; valid_during: string; knowledge: string }>(
          `SELECT pv.id, pv.valid_during::text AS valid_during, pv.knowledge::text AS knowledge
           FROM corpus.provision_versions pv JOIN corpus.provisions p ON p.id = pv.provision_id
           WHERE p.stable_key = $1 ORDER BY lower(pv.valid_during), lower(pv.knowledge)`,
          [key],
        )
      ).rows
    const before903 = await ids('go:rcte:art:903')
    const result = await container.useCases.ingestDocumentVersion({
      runId,
      source: v2,
      blobRaw: null,
      blobDocling: null,
      parserRevision: 1,
    })
    expect(result).toMatchObject({
      status: 'published',
      provisionVersionsNew: 2,
      provisionVersionsWidened: 1,
      provisionVersionsSplit: 0,
      knowledgeClosed: 3,
    })

    // 901: idêntico, mesma linha, agora com as duas versões de documento como fonte.
    expect(
      await count(
        'chunk_sources',
        `chunk_id IN (SELECT c.id FROM corpus.chunks c
      JOIN corpus.provision_versions pv ON pv.id = c.provision_version_id
      JOIN corpus.provisions p ON p.id = pv.provision_id WHERE p.stable_key = 'go:rcte:art:901')`,
      ),
    ).toBe(2)
    // 903: a redação idêntica foi alargada (mesmo ID), a que sumiu teve o knowledge fechado.
    const after903 = await ids('go:rcte:art:903')
    expect(after903).toEqual([
      { id: before903[0]?.id, valid_during: '[2005-01-01,)', knowledge: '[2026-01-10,)' },
      { id: before903[1]?.id, valid_during: '[2020-01-01,)', knowledge: '[2026-01-10,2026-06-01)' },
    ])
    expect(
      await count(
        'chunks',
        `provision_version_id = '${String(before903[0]?.id)}' AND valid_during = '[2005-01-01,)'`,
      ),
    ).toBe(1)
    // 902: a redação aberta mudou de intervalo (correção): fecha e entra a nova; a antiga fica.
    expect((await ids('go:rcte:art:902')).map((row) => [row.valid_during, row.knowledge])).toEqual([
      ['[2000-01-01,2010-01-01)', '[2026-01-10,)'],
      ['[2010-01-01,)', '[2026-01-10,2026-06-01)'],
      ['[2010-01-01,2026-05-01)', '[2026-06-01,)'],
      ['[2026-05-01,)', '[2026-06-01,)'],
    ])
    // 904: removido da consolidação.
    expect((await ids('go:rcte:art:904')).map((row) => row.knowledge)).toEqual([
      '[2026-01-10,2026-06-01)',
    ])
    // Armazenamento: chunk fechado sem vetor; todo chunk aberto com vetor.
    expect(await count('chunks', 'NOT upper_inf(knowledge) AND embedding IS NOT NULL')).toBe(0)
    expect(await count('chunks', 'NOT upper_inf(knowledge)')).toBeGreaterThan(0)
    expect(await count('chunks', 'upper_inf(knowledge) AND embedding IS NULL')).toBe(0)
    // O snapshot anterior passa a valer até a nova consolidação.
    const { rows } = await owner.query<{ valid_during: string }>(
      'SELECT valid_during::text AS valid_during FROM corpus.document_versions WHERE id = $1',
      [first.status === 'published' ? first.documentVersionId : ''],
    )
    expect(rows[0]?.valid_during).toBe('[2026-01-10,2026-06-01)')

    const refreshed = await container.useCases.refreshCoverage({ runId, verifiedAt: '2026-11-10' })
    expect(refreshed.corpusVersion).toBe(1)
    const coverage = await owner.query<{ covered: string; verified_at: string }>(
      `SELECT covered::text AS covered, verified_at::text AS verified_at FROM corpus.coverage WHERE family = 'rcte'`,
    )
    expect(coverage.rows).toEqual([{ covered: '{[2000-01-01,)}', verified_at: '2026-11-10' }])
    expect(await count('chunks', 'corpus_version = 0')).toBe(0)
  })
})

describe('lacunas de cobertura na ingestão (M1)', () => {
  it('só limpa a lacuna do documento que ganhou versão nova depois da detecção', async () => {
    const { container } = context()
    const { useCases } = container
    const ingest = async (runId: string, source: typeof V1, parserRevision = 1) =>
      useCases.ingestDocumentVersion({
        runId,
        source,
        blobRaw: null,
        blobDocling: null,
        parserRevision,
      })
    const gapRow = async () =>
      (
        await owner.query<{ gaps: string; gap_reason: string | null; gap_entries: unknown }>(
          `SELECT gaps::text AS gaps, gap_reason, gap_entries FROM corpus.coverage
           WHERE family = 'rcte'`,
        )
      ).rows[0]

    const first = await useCases.startIngestionRun({ target: 'staging', gitSha: 'g' })
    await ingest(first.runId, V1)
    await useCases.refreshCoverage({ runId: first.runId, verifiedAt: '2026-11-10' })

    // O source-watch detecta duas mudanças na família depois da primeira ingestão.
    // Relógio do banco (o do contêiner pode diferir do da máquina).
    const clock = await owner.query<{ now: string }>(
      `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now`,
    )
    const detectedAt = clock.rows[0]?.now ?? ''
    const rcteGap = {
      sources: ['rcte'],
      from: '2026-11-10',
      to: null,
      detectedAt,
      reason: 'Decreto nº 10.995',
    }
    const otherGap = { ...rcteGap, sources: ['outro-documento'], reason: 'Outro documento' }
    await owner.query(
      `UPDATE corpus.coverage SET gaps = '{[2026-11-10,)}', gap_reason = 'x',
         gap_entries = $1::jsonb WHERE family = 'rcte'`,
      [JSON.stringify([rcteGap, otherGap])],
    )

    // Reprocessar a versão antiga (revisão do parser) publica o rcte, mas não resolve a lacuna.
    const second = await useCases.startIngestionRun({ target: 'staging', gitSha: 'g' })
    expect(await ingest(second.runId, V1, 2)).toMatchObject({
      status: 'published',
      reprocessed: true,
    })
    await useCases.refreshCoverage({ runId: second.runId, verifiedAt: '2026-11-11' })
    expect((await gapRow())?.gap_entries).toEqual([rcteGap, otherGap])

    // Uma versão nova do rcte resolve só a lacuna dele.
    const third = await useCases.startIngestionRun({ target: 'staging', gitSha: 'g' })
    await ingest(
      third.runId,
      rcteSource('dec-2', '2026-11-12', [
        article(901, [
          version('Art. 901. Texto original do artigo novecentos e um.', interval('2000-01-01')),
        ]),
      ]),
    )
    await useCases.refreshCoverage({ runId: third.runId, verifiedAt: '2026-11-12' })
    expect(await gapRow()).toEqual({
      gaps: '{[2026-11-10,)}',
      gap_reason: 'Outro documento',
      gap_entries: [otherGap],
    })
  })
})

describe('Guia: janela do período do leiaute', () => {
  it('alarga versões consecutivas iguais e recorta a vigência numa versão corretiva', async () => {
    const { container, spy } = context()
    const { runId } = await container.useCases.startIngestionRun({ target: 'staging', gitSha: 'h' })
    const field = (text: string, period: ReturnType<typeof interval>) =>
      version(text, period, { label: 'Registro C' })
    const p2025 = interval('2025-01-01', '2026-01-01')
    const p2026 = interval('2026-01-01')
    await container.useCases.ingestDocumentVersion({
      runId,
      source: guiaSource('guia-2025', '2025-01-10', p2025, [
        article(
          100,
          [field('Registro C100: documento fiscal (texto estável).', p2025)],
          'efd-icms-ipi',
        ),
        article(170, [field('Registro C170: itens do documento (2025).', p2025)], 'efd-icms-ipi'),
      ]),
      blobRaw: null,
      blobDocling: null,
      parserRevision: 1,
    })
    const v2026 = await container.useCases.ingestDocumentVersion({
      runId,
      source: guiaSource('guia-2026', '2026-01-10', p2026, [
        article(
          100,
          [field('Registro C100: documento fiscal (texto estável).', p2026)],
          'efd-icms-ipi',
        ),
        article(170, [field('Registro C170: itens do documento (2026).', p2026)], 'efd-icms-ipi'),
      ]),
      blobRaw: null,
      blobDocling: null,
      parserRevision: 1,
    })
    expect(v2026).toMatchObject({
      provisionVersionsNew: 1,
      provisionVersionsWidened: 1,
      knowledgeClosed: 0,
    })
    const c100 = async () =>
      (
        await owner.query<{
          valid_during: string
          knowledge: string
          embedded: boolean
          sources: number
        }>(
          `SELECT pv.valid_during::text AS valid_during, pv.knowledge::text AS knowledge,
             bool_and(c.embedding IS NOT NULL) AS embedded, count(s.*)::int AS sources
           FROM corpus.provision_versions pv JOIN corpus.provisions p ON p.id = pv.provision_id
           JOIN corpus.chunks c ON c.provision_version_id = pv.id
           LEFT JOIN corpus.chunk_sources s ON s.chunk_id = c.id
           WHERE p.stable_key = 'br:efd-icms-ipi:reg:C100'
           GROUP BY pv.id ORDER BY lower(pv.knowledge)`,
        )
      ).rows
    expect(await c100()).toEqual([
      { valid_during: '[2025-01-01,)', knowledge: '[2025-01-10,)', embedded: true, sources: 2 },
    ])

    // Versão corretiva do período de 2026 sem o C100: a parte de 2025 continua valendo.
    spy.reset()
    const corrective = await container.useCases.ingestDocumentVersion({
      runId,
      source: guiaSource('guia-2026-corretiva', '2026-03-01', p2026, [
        article(170, [field('Registro C170: itens do documento (2026).', p2026)], 'efd-icms-ipi'),
      ]),
      blobRaw: null,
      blobDocling: null,
      parserRevision: 1,
    })
    expect(corrective).toMatchObject({
      provisionVersionsNew: 0,
      provisionVersionsSplit: 1,
      knowledgeClosed: 1,
    })
    expect(spy.calls).toEqual([])
    expect(await c100()).toEqual([
      {
        valid_during: '[2025-01-01,)',
        knowledge: '[2025-01-10,2026-03-01)',
        // A fechada perde o vetor, mas só depois de o recorte copiá-lo.
        embedded: false,
        sources: 2,
      },
      {
        valid_during: '[2025-01-01,2026-01-01)',
        knowledge: '[2026-03-01,)',
        embedded: true,
        sources: 2,
      },
    ])
  })
})

describe('REINF: grupos achatados', () => {
  it('grava pai e filho com o mesmo número de segmentos na stable_key', async () => {
    const { container } = context()
    const evt = 'br:efd-reinf:evt:R-2010'
    const period = interval('2023-09-01')
    const node = (
      stableKey: string,
      parent: string | undefined,
      text: string,
      sortPath: string,
    ) => ({
      stableKey,
      kind: parent === undefined ? 'evento' : 'grupo',
      ...(parent === undefined ? {} : { parent }),
      sortPath,
      headingPath: `EFD-REINF > ${stableKey}`,
      versions: [
        {
          ...version(text, period, { label: stableKey }),
          validityBasis: 'leiaute_period' as const,
        },
      ],
    })
    const base = guiaSource('reinf-2.1.2', '2023-03-16', period, [])
    const source = {
      ...base,
      document: {
        slug: 'leiautes-efd-reinf',
        family: 'efd-reinf' as const,
        title: 'Leiautes dos eventos da EFD-Reinf',
        issuer: 'Receita Federal do Brasil',
        sourceUrl: 'https://www.gov.br/sped/pt-br/assuntos/escrituracoes-digitais/efd-reinf',
      },
      // Filhos antes dos pais, e o neto com o mesmo número de segmentos do pai.
      provisions: [
        node(
          `${evt}:grupo:ideEstabObra`,
          `${evt}:grupo:infoServTom`,
          'Grupo ideEstabObra.',
          '02.01',
        ),
        node(`${evt}:grupo:infoServTom`, evt, 'Grupo infoServTom.', '02'),
        node(evt, undefined, 'Evento R-2010.', '00'),
      ],
    }
    const { runId } = await container.useCases.startIngestionRun({ target: 'staging', gitSha: 'k' })
    const result = await container.useCases.ingestDocumentVersion({
      runId,
      source,
      blobRaw: null,
      blobDocling: null,
      parserRevision: 1,
    })
    expect(result).toMatchObject({ status: 'published', provisionVersionsNew: 3 })
    const { rows } = await owner.query<{ stable_key: string; parent: string | null }>(
      `SELECT p.stable_key, pp.stable_key AS parent FROM corpus.provisions p
       LEFT JOIN corpus.provisions pp ON pp.id = p.parent_id ORDER BY p.sort_path`,
    )
    expect(rows).toEqual([
      { stable_key: evt, parent: null },
      { stable_key: `${evt}:grupo:infoServTom`, parent: evt },
      { stable_key: `${evt}:grupo:ideEstabObra`, parent: `${evt}:grupo:infoServTom` },
    ])
  })
})

describe('guarda de tamanho', () => {
  it('aborta a ingestão quando o banco passa do limite', async () => {
    const { container, spy } = context({ maxDatabaseBytes: 1024 })
    const { runId } = await container.useCases.startIngestionRun({ target: 'staging', gitSha: 'i' })
    await expect(
      container.useCases.ingestDocumentVersion({
        runId,
        source: V1,
        blobRaw: null,
        blobDocling: null,
        parserRevision: 1,
      }),
    ).rejects.toBeInstanceOf(DatabaseSizeLimitError)
    expect(spy.calls).toEqual([])
    expect(await count('document_versions')).toBe(0)
  })

  it('--bulk só no staging, derruba o HNSW e o fechamento o recria', async () => {
    const { container } = context()
    await expect(
      container.useCases.startIngestionRun({ target: 'production', gitSha: 'j', bulk: true }),
    ).rejects.toThrow(/--bulk/)
    const { runId } = await container.useCases.startIngestionRun({
      target: 'staging',
      gitSha: 'j',
      bulk: true,
    })
    const indexes = async () =>
      (
        await owner.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'chunks_embedding_hnsw'`,
        )
      ).rows[0]?.n
    expect(await indexes()).toBe(0)
    await container.useCases.ingestDocumentVersion({
      runId,
      source: V1,
      blobRaw: null,
      blobDocling: null,
      parserRevision: 1,
    })
    await container.useCases.finishIngestionRun({
      runId,
      status: 'succeeded',
      report: { chunksNew: 6 },
    })
    expect(await indexes()).toBe(1)
    const { rows } = await owner.query<{
      docs: number
      chunks_new: number
      db_bytes: string
      cu_seconds: string | null
    }>(
      'SELECT docs, chunks_new, db_bytes::text AS db_bytes, cu_seconds FROM corpus.ingestion_runs WHERE id = $1',
      [runId],
    )
    expect(rows[0]).toMatchObject({ docs: 1, chunks_new: 6, cu_seconds: null })
    expect(Number(rows[0]?.db_bytes)).toBeGreaterThan(0)
    // Recriado parcial, como no schema (a migração e o --bulk dão o mesmo índice).
    const definition = await owner.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname IN ('chunks_embedding_hnsw', 'chunks_tsv_gin')
       ORDER BY indexname`,
    )
    expect(definition.rows.map((row) => row.indexdef)).toEqual([
      expect.stringMatching(/USING hnsw .*WHERE upper_inf\(knowledge\)$/),
      expect.stringMatching(/USING gin .*WHERE upper_inf\(knowledge\)$/),
    ])

    // B6: um --bulk que caiu no meio (sem fechamento) deixa o banco sem HNSW; o run seguinte
    // sem --bulk o recria já na abertura.
    await container.useCases.startIngestionRun({ target: 'staging', gitSha: 'k', bulk: true })
    expect(await indexes()).toBe(0)
    await container.useCases.startIngestionRun({ target: 'staging', gitSha: 'l' })
    expect(await indexes()).toBe(1)
  })
})

describe('poda do embedding_cache', () => {
  it('apaga só os vetores que nenhum chunk aberto usa', async () => {
    const { container } = context()
    const { useCases } = container
    const { runId } = await useCases.startIngestionRun({ target: 'staging', gitSha: 'm' })
    await useCases.ingestDocumentVersion({
      runId,
      source: V1,
      blobRaw: null,
      blobDocling: null,
      parserRevision: 1,
    })
    // Um texto que saiu do corpus (versão nova sem o art. 904) e um lixo de outro run.
    await useCases.ingestDocumentVersion({
      runId,
      source: rcteSource(
        'dec-2',
        '2026-06-01',
        V1.provisions.filter((provision) => !provision.stableKey.endsWith(':art:904')),
      ),
      blobRaw: null,
      blobDocling: null,
      parserRevision: 1,
    })
    await owner.query(
      `INSERT INTO corpus.embedding_cache (content_hash, model, embedding)
       SELECT 'lixo', model, embedding FROM corpus.embedding_cache LIMIT 1`,
    )
    expect(await count('embedding_cache')).toBe(7)
    expect(await useCases.pruneEmbeddingCache()).toEqual({ removed: 2, kept: 5 })
    expect(await count('embedding_cache')).toBe(5)
    // Rodar de novo não apaga mais nada, e nada do que está aberto precisa ser reembutido.
    expect(await useCases.pruneEmbeddingCache()).toEqual({ removed: 0, kept: 5 })
  })
})
