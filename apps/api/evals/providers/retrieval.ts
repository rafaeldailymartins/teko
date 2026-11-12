import pg from 'pg'
import { createDatabase, type Database } from '../../src/adapters/out/persistence/drizzle/client.ts'
import { createPgSearchRepository } from '../../src/adapters/out/persistence/drizzle/repositories/pg-search-repository.ts'
import type { RetrievalUseCases } from '../../src/application/container.ts'
import { RetrievalOutcome } from '../../src/application/use-cases/retrieve-evidence.ts'
import { createContainer, createEmbeddings, reviewStatusesFor } from '../../src/composition-root.ts'
import { type Env, parseEnv } from '../../src/config/env.ts'
import { FAMILIES } from '../../src/domain/corpus/family.ts'
import { extractProvisionRefs } from '../../src/domain/qa/provision-refs.ts'
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
let cachedEnv: Env | undefined
let poolDatabase: Database | undefined

function evalEnv(): Env {
  cachedEnv ??= parseEnv({ APP_ENV: 'ci', WEB_ORIGIN: 'http://localhost:3000', ...process.env })
  return cachedEnv
}

function retrievalUseCases(): RetrievalUseCases {
  if (retrieval === undefined) {
    const env = evalEnv()
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
  const pool = await candidatePool(golden, result.reference.value)
  return {
    ...base,
    outcome: result.outcome,
    reason: null,
    hits,
    ...(missing.length > 0 ? { diagnostics: await diagnose(missing, result.reference.value) } : {}),
    ...(pool === null ? {} : { pool }),
  }
}

/**
 * Candidatos da instrução híbrida antes do reranker, na ordem do RRF, com o texto que o reranker
 * recebe ("rótulo de citação + conteúdo"). Só com `EVAL_POOL_SIZE` (o `corpus-eval` usa 50): como o
 * reranker pontua cada par pergunta-texto sozinho, um despejo de 50 permite simular offline
 * qualquer número de candidatos (ADR 0027).
 */
async function candidatePool(
  golden: GoldenCase,
  referenceDate: string,
): Promise<{ stableKey: string; text: string }[] | null> {
  const size = Number(process.env['EVAL_POOL_SIZE'] ?? '0')
  const env = evalEnv()
  const embeddings = createEmbeddings(env)
  if (
    !Number.isInteger(size) ||
    size <= 0 ||
    embeddings === null ||
    env.DATABASE_URL === undefined
  ) {
    return null
  }
  poolDatabase ??= createDatabase({ url: env.DATABASE_URL, applicationName: 'teko-evals-pool' })
  const [vector] = await embeddings.embed([golden.question])
  const families = golden.families ?? FAMILIES
  const evidence = await createPgSearchRepository(poolDatabase.pool).search({
    text: golden.question,
    embedding: vector ?? null,
    referenceDate,
    families,
    stableKeys: extractProvisionRefs(golden.question, families),
    reviewStatuses: reviewStatusesFor(env.APP_ENV),
    limit: size,
  })
  return evidence.map((item) => ({
    stableKey: item.stableKey,
    text: `${item.citationLabel}\n${item.content}`,
  }))
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
