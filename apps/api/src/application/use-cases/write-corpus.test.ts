import { describe, expect, it } from 'vitest'
import { embeddingText } from '#domain/corpus/chunker.ts'
import type { ContentHasher } from '../ports/content-hasher.ts'
import type { CorpusSnapshot } from '../ports/corpus-writer.ts'
import type { EmbeddingPort } from '../ports/embedding-port.ts'
import { createWriteCorpus, type SourceDocument, type WriteCorpusCommand } from './write-corpus.ts'

const hasher: ContentHasher = { hash: (text) => `h(${text})` }

function fakeEmbeddings(vectorFor: (text: string) => number[] | undefined = () => [1, 0]) {
  const calls: string[][] = []
  const port: EmbeddingPort = {
    model: 'fake-model',
    dimensions: 2,
    embed: (texts) => {
      calls.push([...texts])
      return Promise.resolve(texts.map(vectorFor).filter((v): v is number[] => v !== undefined))
    },
  }
  return { port, calls }
}

function capture() {
  const snapshots: CorpusSnapshot[] = []
  return {
    snapshots,
    writer: {
      write: (snapshot: CorpusSnapshot) => {
        snapshots.push(snapshot)
        return Promise.resolve({ corpusVersion: 7, documents: 1, provisionVersions: 2, chunks: 2 })
      },
    },
  }
}

const rcte: SourceDocument = {
  slug: 'rcte',
  family: 'rcte',
  title: 'RCTE',
  issuer: 'Goiás',
  sourceUrl: 'https://example.test/RCTE.htm',
  versions: [
    {
      key: 'v2026',
      versionLabel: 'RCTE consolidado',
      publishedOn: '2026-09-16',
      validDuring: { from: '2026-09-16', to: null },
      consolidatedUntil: 'Decreto nº 10.986',
      actRef: null,
      sha256: 'a'.repeat(64),
    },
    {
      key: 'v2020',
      versionLabel: 'RCTE antigo',
      publishedOn: '2020-01-01',
      validDuring: { from: '2020-01-01', to: '2026-09-16' },
      consolidatedUntil: null,
      actRef: null,
      sha256: 'b'.repeat(64),
    },
  ],
  provisions: [
    {
      stableKey: 'go:rcte:art:76',
      kind: 'artigo',
      sortPath: '0076',
      headingPath: 'RCTE > Art. 76',
      versions: [
        {
          displayLabel: 'RCTE, art. 76',
          validDuring: { from: '1998-01-01', to: null },
          modality: 'mandatory',
          validityBasis: 'legal_effect',
          retroactive: false,
          reviewStatus: 'auto',
          text: 'Art. 76. Texto repetido.',
          documentVersions: ['v2026', 'v2020'],
        },
      ],
    },
    {
      stableKey: 'go:rcte:art:76:par:6',
      kind: 'paragrafo',
      parent: 'go:rcte:art:76',
      sortPath: '0076.p06',
      headingPath: 'RCTE > Art. 76 > § 6º',
      versions: [
        {
          displayLabel: 'RCTE, art. 76, § 6º',
          validDuring: { from: '2004-11-04', to: '2009-11-23' },
          knowledge: { from: '2004-11-04', to: null },
          modality: 'mandatory',
          validityBasis: 'legal_effect',
          retroactive: true,
          reviewStatus: 'approved',
          text: '§ 6º Observado o disposto no § 5º...',
          structured: { nota: 'x' },
          amendment: {
            actLabel: 'Decreto nº 6.026, de 27.10.04',
            actKind: 'decreto',
            actDate: '2004-10-27',
            effectiveFrom: '2004-11-04',
            changeKind: 'nova_redacao',
            rawNote: 'CONFERIDA NOVA REDAÇÃO',
          },
          documentVersions: ['v2026'],
        },
      ],
    },
  ],
}

const command: WriteCorpusCommand = {
  documents: [rcte],
  coverage: [
    {
      family: 'rcte',
      covered: [{ from: '1998-01-01', to: null }],
      verifiedAt: '2026-11-10',
      gaps: [
        { interval: { from: '2026-11-05', to: null }, reason: 'mudança detectada' },
        { interval: { from: '2000-01-01', to: '2000-02-01' }, reason: 'fonte fora do ar' },
      ],
    },
    {
      family: 'cte',
      covered: [{ from: '1997-01-01', to: null }],
      verifiedAt: '2026-11-10',
      gaps: [],
    },
  ],
  notes: 'fixture',
  replace: true,
}

describe('createWriteCorpus', () => {
  it('converte documentos em linhas do corpus, com hashes, chunks, embeddings e cobertura', async () => {
    const { port, calls } = fakeEmbeddings((text) => (text.includes('§ 6º') ? [0, 1] : [1, 0]))
    const { writer, snapshots } = capture()
    const write = createWriteCorpus({ writer, embeddings: port, hasher })

    await expect(write(command)).resolves.toEqual({
      corpusVersion: 7,
      documents: 1,
      provisionVersions: 2,
      chunks: 2,
    })
    expect(calls.flat()).toHaveLength(2)
    expect(calls.flat()).toContain(embeddingText('RCTE > Art. 76', 'Art. 76. Texto repetido.'))

    const [snapshot] = snapshots
    expect(snapshot).toMatchObject({
      embeddingModel: 'fake-model',
      notes: 'fixture',
      replace: true,
    })
    const [doc] = snapshot?.documents ?? []
    expect(doc).toMatchObject({ slug: 'rcte', family: 'rcte', jurisdiction: 'GO' })
    const [article, paragraph] = doc?.provisions ?? []
    expect(article).toMatchObject({ parentStableKey: null, headingPath: 'RCTE > Art. 76' })
    expect(article?.versions[0]).toMatchObject({
      // Sem knowledge explícito: desde a versão de documento mais antiga que contém a redação.
      knowledge: { from: '2020-01-01', to: null },
      contentHash: 'h(Art. 76. Texto repetido.)',
      structured: null,
      amendment: null,
      documentVersionKeys: ['v2026', 'v2020'],
      chunks: [
        {
          ordinal: 0,
          content: 'Art. 76. Texto repetido.',
          contentHash: 'h(Art. 76. Texto repetido.)',
          embedding: [1, 0],
        },
      ],
    })
    expect(paragraph).toMatchObject({ parentStableKey: 'go:rcte:art:76' })
    expect(paragraph?.versions[0]).toMatchObject({
      knowledge: { from: '2004-11-04', to: null },
      retroactive: true,
      reviewStatus: 'approved',
      structured: { nota: 'x' },
      amendment: { actLabel: 'Decreto nº 6.026, de 27.10.04' },
      chunks: [{ embedding: [0, 1] }],
    })
    expect(snapshot?.coverage).toEqual([
      {
        family: 'rcte',
        jurisdiction: 'GO',
        covered: [{ from: '1998-01-01', to: null }],
        verifiedAt: '2026-11-10',
        gaps: [
          { from: '2026-11-05', to: null },
          { from: '2000-01-01', to: '2000-02-01' },
        ],
        gapReason: 'mudança detectada; fonte fora do ar',
      },
      {
        family: 'cte',
        jurisdiction: 'GO',
        covered: [{ from: '1997-01-01', to: null }],
        verifiedAt: '2026-11-10',
        gaps: [],
        gapReason: null,
      },
    ])
  })

  it('embute uma vez cada texto repetido (mesmo título e conteúdo)', async () => {
    const { port, calls } = fakeEmbeddings()
    const { writer } = capture()
    const twice: SourceDocument = {
      ...rcte,
      provisions: [
        rcte.provisions[0] ?? rcte.provisions[1] ?? (undefined as never),
        {
          ...(rcte.provisions[0] ?? (undefined as never)),
          stableKey: 'go:rcte:art:77',
          parent: undefined,
        },
      ],
    }
    await createWriteCorpus({ writer, embeddings: port, hasher })({
      ...command,
      documents: [twice],
    })
    expect(calls.flat()).toHaveLength(1)
  })

  it('redação sem versão de documento conhecida é erro', async () => {
    const { port } = fakeEmbeddings()
    const { writer } = capture()
    const broken: SourceDocument = {
      ...rcte,
      provisions: [
        {
          ...(rcte.provisions[0] ?? (undefined as never)),
          versions: [
            {
              ...(rcte.provisions[0]?.versions[0] ?? (undefined as never)),
              documentVersions: ['x'],
            },
          ],
        },
      ],
    }
    await expect(
      createWriteCorpus({ writer, embeddings: port, hasher })({ ...command, documents: [broken] }),
    ).rejects.toThrow(/sem versão de documento conhecida em rcte/)
  })

  it('vetor ausente ou com dimensão errada é erro', async () => {
    const { writer } = capture()
    for (const vectorFor of [() => undefined, () => [1, 2, 3]]) {
      const { port } = fakeEmbeddings(vectorFor)
      await expect(
        createWriteCorpus({ writer, embeddings: port, hasher })(command),
      ).rejects.toThrow(/dimensão inválida/)
    }
  })
})
