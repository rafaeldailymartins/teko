import { describe, expect, it } from 'vitest'
import type { ParsedSource, ParsedVersion } from '#domain/corpus/parsed-source.ts'
import type { ContentHasher } from '../ports/content-hasher.ts'
import type {
  CorpusIngestionRepository,
  ExistingDocumentVersion,
  IngestionUnitOfWork,
  NewProvisionVersionRow,
  OpenProvisionVersion,
  ReviewItemRow,
} from '../ports/corpus-ingestion-repository.ts'
import { DatabaseSizeLimitError } from '../ports/database-usage.ts'
import { ChurnLimitError } from '../services/churn.ts'
import type { EmbedPending, EmbedPendingResult } from './embed-pending.ts'
import {
  createIngestDocumentVersion,
  planReconciliation,
  ReconciliationError,
  reviewNoteHash,
  widenedInterval,
} from './ingest-document-version.ts'

const hasher: ContentHasher = { hash: (text) => `#${text}` }
const ALL = { from: null, to: null }
const iv = (from: string, to: string | null = null) => ({ from, to })

function open(
  id: string,
  stableKey: string,
  contentHash: string,
  validDuring: { from: string; to: string | null },
  extra: Partial<OpenProvisionVersion> = {},
): OpenProvisionVersion {
  return {
    id,
    stableKey,
    contentHash,
    validDuring,
    modality: 'mandatory',
    reviewStatus: 'auto',
    ...extra,
  }
}

const parsed = (
  contentHash: string,
  validDuring: { from: string; to: string | null },
  extra: Partial<{
    modality: 'mandatory' | 'optional'
    reviewStatus: 'auto' | 'approved' | 'pending' | 'rejected'
  }> = {},
) => ({
  contentHash,
  validDuring,
  modality: 'mandatory' as const,
  reviewStatus: 'auto' as const,
  ...extra,
})

describe('widenedInterval', () => {
  it('alarga quando (E − W) ∪ P é contíguo e contém E', () => {
    expect(
      widenedInterval(iv('2025-01-01', '2026-01-01'), iv('2026-01-01'), iv('2026-01-01')),
    ).toEqual(iv('2025-01-01'))
    expect(widenedInterval(iv('2010-01-01', '2020-01-01'), iv('2010-01-01'), ALL)).toEqual(
      iv('2010-01-01'),
    )
  })

  it('não alarga quando P encolhe E ou fica separado', () => {
    expect(widenedInterval(iv('2010-01-01'), iv('2010-01-01', '2026-05-01'), ALL)).toBeNull()
    expect(
      widenedInterval(
        iv('2020-01-01', '2021-01-01'),
        iv('2022-01-01', '2023-01-01'),
        iv('2022-01-01'),
      ),
    ).toBeNull()
  })
})

describe('planReconciliation', () => {
  it('reaproveita idênticas, alarga contíguas, fecha as sumidas e insere o resto', () => {
    const plan = planReconciliation({
      window: ALL,
      existing: [
        open('a', 'k1', 'h1', iv('2000-01-01')),
        open('b', 'k2', 'h2', iv('2005-01-01', '2020-01-01')),
        open('c', 'k2', 'h3', iv('2020-01-01')),
        open('d', 'k3', 'h4', iv('2001-01-01')),
      ],
      provisions: [
        { stableKey: 'k1', versions: [parsed('h1', iv('2000-01-01'))] },
        { stableKey: 'k2', versions: [parsed('h2', iv('2005-01-01'))] },
        { stableKey: 'k4', versions: [parsed('h5', iv('2026-01-01'))] },
      ],
    })
    expect(plan).toEqual({
      reuse: [{ stableKey: 'k1', index: 0, existingId: 'a' }],
      widen: [{ stableKey: 'k2', index: 0, existingId: 'b', validDuring: iv('2005-01-01') }],
      close: ['c', 'd'],
      remainders: [],
      insert: [{ stableKey: 'k4', index: 0 }],
    })
  })

  it('recorta o trecho fora da janela de uma redação fechada', () => {
    const plan = planReconciliation({
      window: iv('2026-01-01', '2027-01-01'),
      existing: [
        open('a', 'k1', 'h1', iv('2025-01-01')),
        open('b', 'k2', 'h2', iv('2024-01-01', '2025-01-01')),
      ],
      provisions: [],
    })
    expect(plan.close).toEqual(['a'])
    expect(plan.remainders).toEqual([
      { sourceId: 'a', validDuring: iv('2025-01-01', '2026-01-01') },
      { sourceId: 'a', validDuring: iv('2027-01-01') },
    ])
  })

  it('a reconciliação respeita modalidade e classe de revisão', () => {
    const plan = planReconciliation({
      window: ALL,
      existing: [
        open('auto', 'k', 'h', iv('2000-01-01')),
        open('pend', 'k', 'h', iv('2000-01-01'), { reviewStatus: 'pending' }),
        open('opt', 'k', 'h', iv('2000-01-01'), { modality: 'optional' }),
      ],
      provisions: [
        {
          stableKey: 'k',
          versions: [
            parsed('h', iv('2000-01-01'), { reviewStatus: 'approved' }),
            parsed('h', iv('2000-01-01'), { reviewStatus: 'pending' }),
            parsed('h', iv('2000-01-01'), { reviewStatus: 'rejected' }),
          ],
        },
      ],
    })
    expect(plan.reuse.map((entry) => entry.existingId)).toEqual(['auto', 'pend'])
    expect(plan.insert).toEqual([{ stableKey: 'k', index: 2 }])
    expect(plan.close).toEqual(['opt'])
  })

  it('alargamento que não muda nada vira reaproveitamento', () => {
    const plan = planReconciliation({
      window: iv('2025-01-01', '2026-01-01'),
      existing: [open('a', 'k', 'h', iv('2024-01-01', '2026-01-01'))],
      provisions: [{ stableKey: 'k', versions: [parsed('h', iv('2025-01-01', '2026-01-01'))] }],
    })
    expect(plan.reuse).toEqual([{ stableKey: 'k', index: 0, existingId: 'a' }])
    expect(plan.widen).toEqual([])
    expect(plan.close).toEqual([])
  })
})

describe('reviewNoteHash', () => {
  it('usa a nota original e, sem ela, o motivo', () => {
    expect(reviewNoteHash(hasher, { reason: 'x', rawNote: 'nota' })).toBe('#nota')
    expect(reviewNoteHash(hasher, { reason: 'x', rawNote: null })).toBe('#reason:x')
  })
})

// ---------------------------------------------------------------------------------------------

function version(
  text: string,
  validDuring = iv('2000-01-01'),
  extra: Partial<ParsedVersion> = {},
): ParsedVersion {
  return {
    displayLabel: 'RCTE, art. 1',
    validDuring,
    modality: 'mandatory',
    validityBasis: 'legal_effect',
    retroactive: false,
    reviewStatus: 'auto',
    text,
    ...extra,
  }
}

function source(versions: ParsedVersion[], extra: Partial<ParsedSource> = {}): ParsedSource {
  return {
    document: {
      slug: 'rcte',
      family: 'rcte',
      title: 'RCTE',
      issuer: 'GO',
      sourceUrl: 'https://example.gov.br/rcte.htm',
    },
    version: {
      versionLabel: 'v',
      publishedOn: '2026-06-01',
      validDuring: iv('2026-06-01'),
      consolidatedUntil: null,
      actRef: null,
      sha256: 'a'.repeat(64),
    },
    replacementWindow: ALL,
    provisions: [
      {
        stableKey: 'go:rcte:art:1',
        kind: 'artigo',
        sortPath: '0001',
        headingPath: 'RCTE > Art. 1',
        versions,
      },
      {
        stableKey: 'go:rcte:art:1:par:1',
        kind: 'paragrafo',
        parent: 'go:rcte:art:1',
        sortPath: '0001.p01',
        headingPath: 'RCTE > Art. 1 > § 1º',
        labels: [{ label: '§ 1º (antigo parágrafo único)', validDuring: iv('2000-01-01') }],
        versions: [],
      },
    ],
    skipped: [],
    stats: { notesTotal: 0, notesParsed: 0, notesToReview: 0 },
    ...extra,
  }
}

interface Recorder {
  readonly calls: string[]
  inserted: NewProvisionVersionRow[]
  review: ReviewItemRow[]
  sources: string[]
}

function fakeRepository(options: {
  readonly existing?: ExistingDocumentVersion | null
  readonly open?: OpenProvisionVersion[]
  readonly provisionIds?: (keys: string[]) => Map<string, string>
  readonly closedOn?: string
}): { repository: CorpusIngestionRepository; recorder: Recorder } {
  const recorder: Recorder = { calls: [], inserted: [], review: [], sources: [] }
  const uow: IngestionUnitOfWork = {
    upsertDocument: (document) => {
      recorder.calls.push(`document:${document.slug}:${document.jurisdiction}`)
      return Promise.resolve('doc')
    },
    insertDocumentVersion: ({ blobRaw, parserRevision }) => {
      const revision = parserRevision === 1 ? '' : `:rev${String(parserRevision)}`
      recorder.calls.push(`version:${String(blobRaw)}${revision}`)
      return Promise.resolve('dv')
    },
    closePreviousDocumentVersions: (_doc, _dv, from) => {
      recorder.calls.push(`close-previous:${from}`)
      return Promise.resolve(1)
    },
    upsertProvisions: (_doc, rows) => {
      recorder.calls.push(`provisions:${rows.map((row) => row.stableKey).join(',')}`)
      const keys = rows.map((row) => row.stableKey)
      return Promise.resolve(
        options.provisionIds?.(keys) ?? new Map(keys.map((key) => [key, `id-${key}`])),
      )
    },
    addProvisionLabels: (labels) => {
      recorder.calls.push(`labels:${String(labels.length)}`)
      return Promise.resolve()
    },
    lockOpenVersions: () => Promise.resolve(options.open ?? []),
    closeKnowledge: (ids, at) => {
      recorder.calls.push(`close:${ids.join(',')}@${at}`)
      return Promise.resolve(ids.length === 0 ? null : (options.closedOn ?? at))
    },
    insertRemainders: (rows) => {
      recorder.calls.push(`remainders:${String(rows.length)}`)
      return Promise.resolve(rows.map((_, index) => `r${String(index)}`))
    },
    releaseClosedEmbeddings: (ids) => {
      recorder.calls.push(`release:${ids.join(',')}`)
      return Promise.resolve()
    },
    widen: (rows) => {
      recorder.calls.push(`widen:${rows.map((row) => row.id).join(',')}`)
      return Promise.resolve()
    },
    insertVersions: (rows, context) => {
      recorder.calls.push(
        `insert:${String(rows.length)}:${context.family}:${context.embeddingModel}`,
      )
      recorder.inserted = [...rows]
      return Promise.resolve(rows.map((_, index) => `pv${String(index)}`))
    },
    addSources: (ids, dv) => {
      recorder.sources = [...ids]
      recorder.calls.push(`sources:${dv}`)
      return Promise.resolve()
    },
    enqueueReview: (items) => {
      recorder.review = [...items]
      return Promise.resolve(items.length)
    },
    markPublished: (dv) => {
      recorder.calls.push(`published:${dv}`)
      return Promise.resolve()
    },
    assertPublishedSources: () => {
      recorder.calls.push('invariant')
      return Promise.resolve()
    },
  }
  const repository: CorpusIngestionRepository = {
    findDocumentVersion: () => Promise.resolve(options.existing ?? null),
    openVersionsOf: () => Promise.resolve(options.open ?? []),
    transaction: (work) => work(uow),
    refreshCoverage: () => Promise.reject(new Error('não usado')),
    documentHealth: () => Promise.reject(new Error('não usado')),
    openReviewQueue: () => Promise.reject(new Error('não usado')),
    openChunkTexts: () => {
      throw new Error('não usado')
    },
  }
  return { repository, recorder }
}

function setup(options: {
  readonly existing?: ExistingDocumentVersion | null
  readonly open?: OpenProvisionVersion[]
  readonly size?: number
  readonly bytesPerChunk?: number
  readonly embed?: EmbedPendingResult
  readonly cached?: (hash: string) => number[] | undefined
  readonly provisionIds?: (keys: string[]) => Map<string, string>
  readonly closedOn?: string
}) {
  const { repository, recorder } = fakeRepository(options)
  const requested: string[] = []
  const embedPending: EmbedPending = ({ texts }) => {
    requested.push(...texts.map((entry) => entry.text))
    return Promise.resolve(
      options.embed ?? { status: 'complete', neurons: 3, embedded: texts.length, cached: 0 },
    )
  }
  const ingest = createIngestDocumentVersion({
    repository,
    cache: {
      getMany: (hashes) =>
        Promise.resolve(
          new Map(
            hashes.flatMap((hash) => {
              const found = options.cached === undefined ? [1, 2] : options.cached(hash)
              return found === undefined ? [] : [[hash, found] as const]
            }),
          ),
        ),
      putMany: () => Promise.resolve(),
      retainOnly: () => Promise.resolve(0),
    },
    embedPending,
    embeddingModel: 'bge',
    hasher,
    databaseUsage: { sizeBytes: () => Promise.resolve(options.size ?? 10) },
    maxDatabaseBytes: 100,
    bytesPerChunk: options.bytesPerChunk ?? 1,
  })
  return { ingest, recorder, requested }
}

const command = (src: ParsedSource) => ({
  runId: 'run',
  source: src,
  blobRaw: 'raw',
  blobDocling: null,
  parserRevision: 1,
})

describe('IngestDocumentVersion', () => {
  it('sha256 já publicado: unchanged, sem banco nem embeddings', async () => {
    const { ingest, recorder, requested } = setup({
      existing: { id: 'dv0', status: 'published', parserRevision: 1 },
    })
    expect(await ingest(command(source([version('Art. 1. Texto.')])))).toEqual({
      status: 'unchanged',
      documentVersionId: 'dv0',
    })
    expect(recorder.calls).toEqual([])
    expect(requested).toEqual([])
  })

  it('sha256 publicado com revisão do parser maior ou igual: unchanged (ADR 0026)', async () => {
    const newer = setup({ existing: { id: 'dv0', status: 'published', parserRevision: 3 } })
    expect(
      await newer.ingest({ ...command(source([version('Art. 1. Texto.')])), parserRevision: 2 }),
    ).toEqual({ status: 'unchanged', documentVersionId: 'dv0' })
    expect(newer.recorder.calls).toEqual([])
  })

  it('B4: as redações novas começam no fechamento mais tardio (reprocessamento)', async () => {
    const { ingest, recorder } = setup({
      existing: { id: 'dv0', status: 'published', parserRevision: 1 },
      open: [open('velha', 'go:rcte:art:1', '#Art. 1. Redação velha.', iv('2000-01-01'))],
      closedOn: '2026-06-02',
    })
    await ingest({
      ...command(source([version('Art. 1. Redação corrigida.', iv('2000-01-01'))])),
      parserRevision: 2,
    })
    expect(recorder.inserted[0]?.knowledge).toEqual(iv('2026-06-02'))
  })

  it('sha256 publicado com revisão menor do parser: reprocessa a mesma versão', async () => {
    const { ingest, recorder, requested } = setup({
      existing: { id: 'dv0', status: 'published', parserRevision: 1 },
      open: [open('velha', 'go:rcte:art:1', '#Art. 1. Redação velha.', iv('2000-01-01'))],
    })
    const result = await ingest({
      ...command(source([version('Art. 1. Redação corrigida.', iv('2000-01-01'))])),
      parserRevision: 2,
    })
    expect(result).toMatchObject({
      status: 'published',
      reprocessed: true,
      provisionVersionsNew: 1,
      knowledgeClosed: 1,
    })
    expect(requested).toEqual(['RCTE > Art. 1\n\nArt. 1. Redação corrigida.'])
    expect(recorder.calls).toContain('version:raw:rev2')
  })

  it('aborta acima da guarda de tamanho', async () => {
    const { ingest } = setup({ size: 101 })
    await expect(ingest(command(source([version('Art. 1. Texto.')])))).rejects.toBeInstanceOf(
      DatabaseSizeLimitError,
    )
  })

  it('guarda prospectiva: os chunks novos passariam do limite, aborta antes de embutir', async () => {
    const { ingest, requested, recorder } = setup({ size: 60, bytesPerChunk: 25 })
    // Duas redações novas, um chunk cada: 60 + 2 × 25 = 110 > 100.
    const error = await ingest(
      command(source([version('Art. 1. Texto.'), version('Art. 1. Outro.', iv('2010-01-01'))])),
    ).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(DatabaseSizeLimitError)
    expect(error).toMatchObject({
      sizeBytes: 110,
      limitBytes: 100,
      projection: { currentBytes: 60, newChunks: 2, bytesPerChunk: 25 },
    })
    expect(String(error)).toMatch(/2 chunks novos/)
    expect(requested).toEqual([])
    expect(recorder.calls).toEqual([])

    // Reaproveitar a mesma redação não conta chunk novo.
    const reuse = setup({
      size: 99,
      bytesPerChunk: 25,
      open: [open('pv', 'go:rcte:art:1', '#Art. 1. Texto.', iv('2000-01-01'))],
    })
    await expect(
      reuse.ingest(command(source([version('Art. 1. Texto.', iv('2000-01-01'))]))),
    ).resolves.toMatchObject({ status: 'published', provisionVersionsNew: 0 })
  })

  it('disjuntor: mudança em massa falha o item antes de embutir, salvo acceptChurn', async () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      open(`pv${String(index)}`, `go:rcte:art:${String(index + 10)}`, '#x', iv('2000-01-01')),
    )
    const tripped = setup({ open: many })
    const error = await tripped
      .ingest(command(source([version('Art. 1. Texto.')])))
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ChurnLimitError)
    expect(error).toMatchObject({ metrics: { openBefore: 20, closed: 20, provisionsLost: 20 } })
    expect(tripped.requested).toEqual([])
    expect(tripped.recorder.calls).toEqual([])

    const accepted = setup({ open: many })
    const result = await accepted.ingest({
      ...command(source([version('Art. 1. Texto.')])),
      acceptChurn: true,
    })
    expect(result).toMatchObject({ status: 'published', knowledgeClosed: 20 })
    expect(result.status === 'published' ? result.churnViolations : []).toHaveLength(2)
  })

  it('orçamento esgotado: devolve budget_exhausted sem abrir a transação', async () => {
    const { ingest, recorder } = setup({
      embed: { status: 'budget_exhausted', neurons: 5, embedded: 1, cached: 0, pending: 2 },
    })
    expect(await ingest(command(source([version('Art. 1. Texto.')])))).toEqual({
      status: 'budget_exhausted',
      neurons: 5,
      embeddedChunks: 1,
      pendingChunks: 2,
    })
    expect(recorder.calls).toEqual([])
  })

  it('publica: ordem das operações, fontes, fila de revisão e contagens', async () => {
    const { ingest, recorder, requested } = setup({
      existing: { id: 'dv-falha', status: 'failed', parserRevision: 1 },
      open: [
        open('velha', 'go:rcte:art:1', '#Art. 1. Redação velha.', iv('2000-01-01')),
        open('igual', 'go:rcte:art:1', '#Art. 1. Igual.', iv('1990-01-01', '2000-01-01')),
      ],
    })
    const result = await ingest(
      command(
        source([
          version('Art. 1. Igual.', iv('1990-01-01', '2000-01-01')),
          version('Art. 1. Redação nova.', iv('2000-01-01'), {
            amendment: {
              actLabel: 'Decreto 1',
              actKind: 'decreto',
              actDate: '2026-05-01',
              effectiveFrom: '2000-01-01',
              changeKind: 'nova_redacao',
              rawNote: 'nota',
            },
            structured: { campo: 1 },
          }),
          version('Art. 1. Anomalia.', iv('1995-01-01', '2005-01-01'), {
            reviewStatus: 'pending',
            review: { reason: 'note-unparsed', rawNote: 'nota ilegível' },
          }),
          version('Art. 1. Pendente sem motivo.', iv('1980-01-01', '1985-01-01'), {
            reviewStatus: 'pending',
          }),
        ]),
      ),
    )
    expect(result).toEqual({
      status: 'published',
      documentVersionId: 'dv',
      reprocessed: false,
      provisionVersionsNew: 3,
      provisionVersionsWidened: 0,
      provisionVersionsSplit: 0,
      knowledgeClosed: 1,
      chunksNew: 3,
      reviewItems: 2,
      neurons: 3,
      churn: {
        openBefore: 2,
        closed: 1,
        inserted: 3,
        provisionsBefore: 1,
        provisionsLost: 0,
        pendingShareBefore: 0,
        pendingShareAfter: 0.5,
      },
      churnViolations: [],
    })
    expect(requested).toEqual([
      'RCTE > Art. 1\n\nArt. 1. Redação nova.',
      'RCTE > Art. 1\n\nArt. 1. Anomalia.',
      'RCTE > Art. 1\n\nArt. 1. Pendente sem motivo.',
    ])
    expect(recorder.calls).toEqual([
      'document:rcte:GO',
      'version:raw',
      'close-previous:2026-06-01',
      'provisions:go:rcte:art:1,go:rcte:art:1:par:1',
      'labels:1',
      'close:velha@2026-06-01',
      'remainders:0',
      'release:velha',
      'widen:',
      'insert:3:rcte:bge',
      'sources:dv',
      'published:dv',
      'invariant',
    ])
    expect(recorder.sources).toEqual(['igual', 'pv0', 'pv1', 'pv2'])
    expect(recorder.inserted[0]).toMatchObject({
      provisionId: 'id-go:rcte:art:1',
      knowledge: iv('2026-06-01'),
      structured: { campo: 1 },
      amendment: { actLabel: 'Decreto 1' },
      chunks: [{ ordinal: 0, content: 'Art. 1. Redação nova.', embedding: [1, 2] }],
    })
    expect(recorder.inserted[1]).toMatchObject({ structured: null, amendment: null })
    expect(recorder.review).toEqual([
      {
        runId: 'run',
        provisionId: 'id-go:rcte:art:1',
        provisionVersionId: 'pv1',
        documentVersionId: 'dv',
        stableKey: 'go:rcte:art:1',
        noteHash: '#nota ilegível',
        reason: 'note-unparsed',
        rawNote: 'nota ilegível',
        proposed: iv('1995-01-01', '2005-01-01'),
      },
      expect.objectContaining({ provisionVersionId: 'pv2', reason: 'pending', rawNote: null }),
    ])
  })

  it('alarga a redação idêntica contígua sem embutir nada', async () => {
    const { ingest, recorder, requested } = setup({
      open: [open('curta', 'go:rcte:art:1', '#Art. 1. Texto.', iv('2000-01-01', '2010-01-01'))],
    })
    const result = await ingest(command(source([version('Art. 1. Texto.', iv('2000-01-01'))])))
    expect(result).toMatchObject({
      provisionVersionsNew: 0,
      provisionVersionsWidened: 1,
      chunksNew: 0,
    })
    expect(requested).toEqual([])
    expect(recorder.calls).toContain('widen:curta')
    expect(recorder.sources).toEqual(['curta'])
  })

  it('fecha versões anteriores a partir do publishedOn quando a versão não tem início', async () => {
    const src = source([version('Art. 1. Texto.')])
    const { ingest, recorder } = setup({})
    await ingest(
      command({ ...src, version: { ...src.version, validDuring: { from: null, to: null } } }),
    )
    expect(recorder.calls).toContain('close-previous:2026-06-01')
  })

  it('falha se o embedding de um chunk novo sumiu do cache', async () => {
    const { ingest } = setup({ cached: () => undefined })
    await expect(ingest(command(source([version('Art. 1. Texto.')])))).rejects.toBeInstanceOf(
      ReconciliationError,
    )
  })

  it('falha se um dispositivo ficou sem ID depois do upsert', async () => {
    const { ingest } = setup({ provisionIds: () => new Map() })
    await expect(ingest(command(source([version('Art. 1. Texto.')])))).rejects.toThrow(/sem ID/)
  })
})
