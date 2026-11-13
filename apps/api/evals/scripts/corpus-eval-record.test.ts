import { describe, expect, it } from 'vitest'
import { createInMemoryBlobStore } from '../../src/adapters/out/fakes/in-memory-blob-store.ts'
import { BlobStoreName } from '../../src/application/ports/blob-store.ts'
import { evaluateThresholds } from './check-thresholds.ts'
import {
  buildRecord,
  type EvalRecord,
  evalRecordSchema,
  historyKey,
  recordHistory,
  renderComparison,
  renderEvalSummary,
  renderPrBody,
} from './corpus-eval-record.ts'

function output(scores: Record<string, number[]>) {
  const cases = Math.max(...Object.values(scores).map((values) => values.length))
  return {
    results: {
      results: Array.from({ length: cases }, (_, index) => ({
        testCase: { description: `caso-${String(index)}` },
        gradingResult: {
          componentResults: Object.entries(scores).flatMap(([metric, values]) =>
            values[index] === undefined ? [] : [{ score: values[index], assertion: { metric } }],
          ),
        },
      })),
    },
  }
}

const dev = evaluateThresholds(output({ mrr: [1, 0.5], 'recall@10': [1, 1] }), {
  mrr: 0.65,
  'recall@10': 0.9,
})
const holdout = evaluateThresholds(
  output({ mrr: [0.5, 0.25], recusa: [1] }),
  { mrr: null, recusa: 1 },
  { mrr: 0.7 },
)

function record(corpusVersion: number, devMrr = 0.75): EvalRecord {
  const base = buildRecord({
    reports: { dev, holdout },
    corpusVersion,
    gitSha: '0123456789abcdef0123',
    runUrl: 'https://github.com/o/r/actions/runs/1',
    retrieval: { embeddings: 'workers-ai', reranker: 'workers-ai' },
    now: new Date('2026-11-12T12:00:00Z'),
  })
  return evalRecordSchema.parse({
    ...base,
    suites: {
      ...base.suites,
      dev: {
        ...base.suites.dev,
        metrics: {
          ...base.suites.dev.metrics,
          mrr: { ...base.suites.dev.metrics['mrr'], mean: devMrr },
        },
      },
    },
  })
}

describe('registro do corpus-eval', () => {
  it('junta dev e holdout, com gate, meta e intervalo por métrica', () => {
    const current = record(12)
    expect(current.pass).toBe(true)
    expect(current.suites.dev.thresholds).toBe('retrieval-corpus')
    expect(current.suites.holdout.thresholds).toBe('retrieval-holdout')
    expect(current.suites.holdout.metrics['mrr']).toMatchObject({
      mean: 0.375,
      threshold: null,
      target: 0.7,
      cases: 2,
      pass: true,
    })
    const failed = buildRecord({
      reports: { dev, holdout: evaluateThresholds(output({ recusa: [0] }), { recusa: 1 }) },
      corpusVersion: 12,
      gitSha: null,
      runUrl: null,
      retrieval: { embeddings: 'workers-ai', reranker: 'none' },
      now: new Date('2026-11-12T12:00:00Z'),
    })
    expect(failed.pass).toBe(false)
  })

  it('resumo e corpo do PR do lock trazem a corpus_version e as duas tabelas', () => {
    const current = record(12)
    const summary = renderEvalSummary(current, { dev, holdout })
    expect(summary).toContain('## corpus-eval (corpus_version 12): aprovado')
    expect(summary).toContain('### Conjunto dev (onde se ajusta): aprovado')
    expect(summary).toContain('### Conjunto holdout (nunca orienta parâmetros): aprovado')
    expect(summary).toContain('- `mrr` caso-1: score 0.5')
    const body = renderPrBody(current)
    expect(body).toContain('### corpus-eval da corpus_version 12: aprovado')
    expect(body).toContain('| dev | mrr | 0.750 |')
    expect(body).toContain('| holdout | mrr | 0.375 |')
    expect(body).toContain('| — | 2 |')
    expect(body).toContain('código em `0123456789ab`')
  })
})

describe('histórico do corpus-eval', () => {
  it('chave ordena pela corpus_version e pelo run_id', () => {
    expect(historyKey(12, '43287466540')).toBe('history/corpus-v000012/43287466540.json')
    expect(historyKey(9, '9') < historyKey(12, '1')).toBe(true)
  })

  it('grava no eval-artifacts e devolve o registro anterior mais recente', async () => {
    const blobs = createInMemoryBlobStore()
    expect(await recordHistory(blobs, record(11, 0.66), '100')).toBeNull()
    await blobs.set(BlobStoreName.EvalArtifacts, 'history/corpus-v000011/150.json', '{"x":1}')
    const previous = await recordHistory(blobs, record(12, 0.7), '200')
    expect(previous?.corpusVersion).toBe(11)
    expect(blobs.keys(BlobStoreName.EvalArtifacts)).toEqual([
      'history/corpus-v000011/100.json',
      'history/corpus-v000011/150.json',
      'history/corpus-v000012/200.json',
    ])
    // Rodar de novo o mesmo run (re-run do job) compara com o anterior, não consigo mesmo.
    expect((await recordHistory(blobs, record(12, 0.7), '200'))?.corpusVersion).toBe(11)
  })

  it('comparação anterior → atual por conjunto e métrica', () => {
    expect(renderComparison(null, record(12))).toBe(
      'Histórico: primeiro registro (corpus_version 12).\n',
    )
    const table = renderComparison(record(11, 0.66), record(12, 0.7))
    expect(table).toContain('#### Histórico: corpus_version 11 → 12')
    expect(table).toContain('| dev | mrr | 0.660 | 0.700 | +0.040 |')
    expect(table).toContain('| holdout | mrr | 0.375 | 0.375 | +0.000 |')
  })
})
