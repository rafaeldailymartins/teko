import pg from 'pg'
import type { RetrievalUseCases } from '../../src/application/container.ts'
import { RetrievalOutcome } from '../../src/application/use-cases/retrieve-evidence.ts'
import { createContainer } from '../../src/composition-root.ts'
import { parseEnv } from '../../src/config/env.ts'
import { RECALL_K, type RetrievalOutput } from '../asserts/metrics.ts'
import type { GoldenCase } from '../datasets/schema.ts'

/**
 * Provider das retrieval evals: chama o `RetrieveEvidence` in-process (data de referência →
 * cobertura → busca híbrida), sem LLM e sem segredo, então roda também em PR de fork. Exige um
 * Postgres com a fixture (`pnpm --filter @teko/api seed:fixtures`) e o fake de embeddings em modo
 * strict:
 *
 *     DATABASE_URL=... EMBEDDINGS_PROVIDER=fake EMBEDDINGS_FAKE_STRICT=true \
 *     EMBEDDINGS_FIXTURE_PATH=test/fixtures/corpus/embeddings.json.gz
 *
 * O relógio é fixo em 2026-11-10 (como em todos os testes): o default de data é 2026-10-01.
 */

export const EVAL_CLOCK_INSTANT = '2026-11-10T12:00:00-03:00'

interface CallContext {
  readonly vars: Readonly<Record<string, unknown>>
}

let retrieval: RetrievalUseCases | undefined

function retrievalUseCases(): RetrievalUseCases {
  if (retrieval === undefined) {
    const env = parseEnv({ APP_ENV: 'ci', WEB_ORIGIN: 'http://localhost:3000', ...process.env })
    const container = createContainer(env, {
      clock: { now: () => new Date(EVAL_CLOCK_INSTANT) },
      applicationName: 'teko-evals',
    })
    if (container.useCases.retrieval === null) {
      throw new Error('as retrieval evals exigem DATABASE_URL e EMBEDDINGS_PROVIDER')
    }
    retrieval = container.useCases.retrieval
  }
  return retrieval
}

/** Corpus avaliado: `EVAL_CORPUS=staging` no `corpus-eval`; o padrão é a fixture do PR. */
export function evalCorpus(): 'fixture' | 'staging' {
  return process.env['EVAL_CORPUS'] === 'staging' ? 'staging' : 'fixture'
}

export function referenceInput(golden: GoldenCase) {
  return golden.periodo_apuracao === undefined
    ? { referenceDate: golden.reference_date ?? '' }
    : { periodoApuracao: golden.periodo_apuracao }
}

export async function retrieve(golden: GoldenCase): Promise<RetrievalOutput> {
  const result = await retrievalUseCases().retrieveEvidence({
    input: referenceInput(golden),
    source: golden.reference_source,
    questionText: golden.question,
    families: golden.families ?? [],
  })
  if (result.outcome === RetrievalOutcome.NeedsClarification) {
    return {
      outcome: result.outcome,
      reason: result.reason,
      referenceDate: null,
      candidates: [...result.candidates],
      mode: null,
      hits: [],
    }
  }
  const base = { referenceDate: result.reference.value, candidates: [], mode: result.mode }
  if (result.outcome === RetrievalOutcome.Refused) {
    return { ...base, outcome: result.outcome, reason: result.reason, hits: [] }
  }
  const hits = result.evidence.map((item) => ({
    stableKey: item.stableKey,
    validity: item.validity,
    versionLabel: item.document.versionLabel,
    rrf: item.rrf,
  }))
  const top = new Set([...new Set(hits.map((hit) => hit.stableKey))].slice(0, RECALL_K))
  const missing = golden.expected.provisions.filter((key) => !top.has(key))
  return {
    ...base,
    outcome: result.outcome,
    reason: null,
    hits,
    ...(missing.length > 0 ? { diagnostics: await diagnose(missing, result.reference.value) } : {}),
  }
}

/**
 * Estado no banco, na data, de cada dispositivo esperado fora do top-k: as redações de
 * conhecimento aberto que contêm a data, com o status de revisão e quantos chunks têm embedding.
 * Só leitura, com a mesma `DATABASE_URL` da busca.
 */
async function diagnose(stableKeys: readonly string[], referenceDate: string) {
  const client = new pg.Client({ connectionString: process.env['DATABASE_URL'] })
  await client.connect()
  try {
    const { rows } = await client.query<{
      stable_key: string
      review_status: string | null
      chunks: number
      embedded: number
    }>(
      `SELECT p.stable_key, pv.review_status,
              count(c.id)::int AS chunks, count(c.embedding)::int AS embedded
       FROM unnest($1::text[]) AS k(stable_key)
       JOIN corpus.provisions p ON p.stable_key = k.stable_key
       LEFT JOIN corpus.provision_versions pv ON pv.provision_id = p.id
         AND pv.valid_during @> $2::date AND upper_inf(pv.knowledge)
       LEFT JOIN corpus.chunks c ON c.provision_version_id = pv.id
       GROUP BY p.stable_key, pv.id, pv.review_status`,
      [stableKeys, referenceDate],
    )
    return stableKeys.map((stableKey) => ({
      stableKey,
      versions: rows
        .filter((row) => row.stable_key === stableKey && row.review_status !== null)
        .map((row) => ({
          reviewStatus: row.review_status ?? '',
          chunks: row.chunks,
          embedded: row.embedded,
        })),
    }))
  } finally {
    await client.end()
  }
}

export default class RetrievalProvider {
  id(): string {
    return 'teko-retrieval'
  }

  async callApi(_prompt: string, context?: CallContext): Promise<{ output: string }> {
    const golden = context?.vars['golden'] as GoldenCase
    return { output: JSON.stringify({ ...(await retrieve(golden)), corpus: evalCorpus() }) }
  }
}
