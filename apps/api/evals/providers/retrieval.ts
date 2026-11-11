import type { RetrievalUseCases } from '../../src/application/container.ts'
import { RetrievalOutcome } from '../../src/application/use-cases/retrieve-evidence.ts'
import { createContainer } from '../../src/composition-root.ts'
import { parseEnv } from '../../src/config/env.ts'
import type { RetrievalOutput } from '../asserts/metrics.ts'
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
  return {
    ...base,
    outcome: result.outcome,
    reason: null,
    hits: result.evidence.map((item) => ({
      stableKey: item.stableKey,
      validity: item.validity,
      versionLabel: item.document.versionLabel,
      rrf: item.rrf,
    })),
  }
}

export default class RetrievalProvider {
  id(): string {
    return 'teko-retrieval'
  }

  async callApi(_prompt: string, context?: CallContext): Promise<{ output: string }> {
    const golden = context?.vars['golden'] as GoldenCase
    return { output: JSON.stringify(await retrieve(golden)) }
  }
}
