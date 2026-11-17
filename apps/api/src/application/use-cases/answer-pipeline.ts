import {
  type Answer,
  type AnswerMeta,
  type Citation,
  DataPartType,
  type Refusal,
  RefusalReason,
  type ResolvedReferenceDate,
  type RetrievalMode,
  type TekoStreamChunk,
} from '@teko/shared/contracts'
import type { Locale } from '@teko/shared/i18n'
import type { ReferenceSource } from '@teko/shared/vigencia'
import { type Family, isFamily, jurisdictionOf } from '#domain/corpus/family.ts'
import { checkCitations, isInsufficient, renderAnswerMarkdown } from '#domain/qa/answer-output.ts'
import type { Evidence } from '#domain/qa/evidence.ts'
import { createStreamSanitizer } from '#domain/qa/stream-sanitizer.ts'
import type { ResolvedReference } from '#domain/vigencia/reference-resolution.ts'
import type { LlmUsage } from '../ports/llm-port.ts'
import type { RetrievalSummary } from '../ports/llm-tracing.ts'
import type { StoredReferenceInput } from '../ports/question-repository.ts'
import { noopTelemetry, type Telemetry } from '../ports/telemetry.ts'
import {
  ANSWER_MAX_OUTPUT_TOKENS,
  ANSWER_TEMPERATURE,
  buildAnswerPrompt,
  PROMPT_CANARY,
} from '../prompts/answer.ts'
import {
  interruptionOf,
  recordFailedGeneration,
  trackGeneration,
} from '../services/generation-trace.ts'
import type { ProviderRouter } from '../services/provider-router.ts'
import { type QueryTrace, untracedQuery } from '../services/trace-sampler.ts'
import { RetrievalOutcome, type RetrieveEvidence } from './retrieve-evidence.ts'

/**
 * O caminho de uma resposta depois que a pergunta foi aceita, sem persistência: data de
 * referência → cobertura → busca → prompt → cadeia de LLM → validação das citações. Produz os
 * chunks do UI Message Stream e, no fim, o resultado (`AnswerOutcome`) para quem grava. Serve ao
 * stream (`StreamAnswer`) e à rota de eval da stack de CI.
 *
 * Ordem dos chunks: `start`, `data-reference-date`, `data-meta`, `data-citation`*, `text-start`,
 * `text-delta`*, `text-end`, `data-citation` (inválidas, de novo com `valid: false`)*,
 * `data-refusal`?; o `finish` (ou `error`) fica com quem grava.
 */
export interface AnswerPipelineInput {
  readonly messageId: string
  readonly question: string
  readonly referenceInput: StoredReferenceInput
  readonly referenceSource: ReferenceSource
  readonly families: readonly string[]
  readonly locale: Locale
  readonly zeroDataRetention: boolean
  readonly signal: AbortSignal
  /** Trace `rag-query` da pergunta (Langfuse); padrão: nenhum. */
  readonly trace?: QueryTrace
}

export interface AnswerOutcome {
  readonly answer: Answer | null
  readonly refusal: Refusal | null
  readonly retrievalMode: RetrievalMode | null
  readonly provider: AnswerMeta['provider'] | null
  readonly model: string | null
  readonly usage: LlmUsage
  /** Instante (ms) do primeiro pedaço de texto do modelo. */
  readonly firstTokenAtMs: number | null
}

export interface AnswerPipelineDeps {
  readonly retrieveEvidence: RetrieveEvidence
  readonly router: ProviderRouter
  readonly corpusVersion: () => Promise<number>
  readonly nowMs: () => number
  /** Sinais de RAG (citações invalidadas, sentinel); padrão: nenhum. */
  readonly telemetry?: Telemetry
}

const TEXT_PART_ID = 'answer'
const NO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0 }
const EXCERPT_LENGTH = 400

export function toResolved(reference: ResolvedReference): ResolvedReferenceDate {
  return {
    value: reference.value,
    source: reference.source,
    periodBoundaryInside: reference.periodBoundaryInside,
    alternatives: [...reference.alternatives],
  }
}

export function toCitation(evidence: Evidence, id: string, valid: boolean): Citation {
  const family = evidence.family
  return {
    id,
    stableKey: evidence.stableKey,
    label: evidence.citationLabel,
    family,
    jurisdiction: isFamily(family) ? jurisdictionOf(family as Family) : 'BR',
    document: {
      title: evidence.document.title,
      versionLabel: evidence.document.versionLabel,
      sourceUrl: evidence.document.sourceUrl,
    },
    validity: evidence.validity,
    isCurrent: evidence.validity.to === null,
    excerpt: evidence.content.slice(0, EXCERPT_LENGTH),
    valid,
  }
}

function refusalChunk(refusal: Refusal): TekoStreamChunk {
  return { type: DataPartType.Refusal, data: refusal }
}

type Retrieval = Awaited<ReturnType<RetrieveEvidence>>

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000

const INTERRUPTED_RETRIEVAL: RetrievalSummary = {
  mode: null,
  topK: 0,
  candidatesByChannel: { lexical: 0, semantic: 0, reference: 0 },
  rrf: [],
  reranked: false,
  rewritten: false,
  uncoveredFamilies: [],
  refusalReason: null,
}

/** O que o span `retrieval` do Langfuse mostra da busca (sem o texto das evidências). */
export function retrievalSummary(retrieval: Retrieval): RetrievalSummary {
  if (retrieval.outcome !== RetrievalOutcome.Evidence) {
    return {
      ...INTERRUPTED_RETRIEVAL,
      mode: retrieval.outcome === RetrievalOutcome.Refused ? retrieval.mode : null,
      refusalReason:
        retrieval.outcome === RetrievalOutcome.Refused
          ? retrieval.reason
          : RefusalReason.NoEvidence,
    }
  }
  const { evidence } = retrieval
  const count = (rank: (item: Evidence) => number | null): number =>
    evidence.filter((item) => rank(item) !== null).length
  return {
    mode: retrieval.mode,
    topK: evidence.length,
    candidatesByChannel: {
      lexical: count((item) => item.lexicalRank),
      semantic: count((item) => item.semanticRank),
      reference: count((item) => item.referenceRank),
    },
    rrf: evidence.map((item) => round4(item.rrf)),
    reranked: retrieval.reranked,
    rewritten: retrieval.rewrittenQuery !== null,
    uncoveredFamilies: [...retrieval.uncoveredFamilies],
    refusalReason: null,
  }
}

/**
 * Gera os chunks e devolve o resultado pelo `onOutcome` antes do último chunk. Falhas (cadeia de
 * LLM fora do ar, cancelamento) saem como exceção, para quem grava decidir o status e o `error`.
 */
export async function* runAnswerPipeline(
  deps: AnswerPipelineDeps,
  input: AnswerPipelineInput,
  onOutcome: (outcome: AnswerOutcome) => void,
): AsyncGenerator<TekoStreamChunk> {
  yield { type: 'start', messageId: input.messageId }
  const trace = input.trace ?? untracedQuery
  const retrievalSpan = trace.retrieval(deps.nowMs())
  let retrieval: Retrieval
  try {
    retrieval = await deps.retrieveEvidence({
      input: input.referenceInput,
      source: input.referenceSource,
      questionText: input.question,
      families: input.families,
      zeroDataRetentionOnly: input.zeroDataRetention,
      signal: input.signal,
      trace,
    })
  } catch (error) {
    // Cancelamento ou falha da busca: o span fecha vazio e o `rag-query` leva o desfecho.
    retrievalSpan.end(INTERRUPTED_RETRIEVAL, deps.nowMs())
    throw error
  }
  retrievalSpan.end(retrievalSummary(retrieval), deps.nowMs())
  if (retrieval.outcome === RetrievalOutcome.NeedsClarification) {
    // A data já foi resolvida no POST; com a mesma entrada, não muda. Por garantia, recusa.
    const refusal: Refusal = { reason: RefusalReason.NoEvidence }
    onOutcome({
      answer: null,
      refusal,
      retrievalMode: null,
      provider: null,
      model: null,
      usage: NO_USAGE,
      firstTokenAtMs: null,
    })
    yield refusalChunk(refusal)
    return
  }
  yield { type: DataPartType.ReferenceDate, data: toResolved(retrieval.reference) }
  if (retrieval.outcome === RetrievalOutcome.Refused) {
    const refusal: Refusal = { reason: retrieval.reason, coverage: [...retrieval.coverage] }
    onOutcome({
      answer: null,
      refusal,
      retrievalMode: retrieval.mode,
      provider: null,
      model: null,
      usage: NO_USAGE,
      firstTokenAtMs: null,
    })
    yield refusalChunk(refusal)
    return
  }

  const prompt = buildAnswerPrompt({
    question: input.question,
    referenceDate: retrieval.reference.value,
    locale: input.locale,
    evidence: retrieval.evidence,
  })
  const citations = retrieval.evidence.map((evidence, index) =>
    toCitation(evidence, prompt.sourceIds[index] as string, true),
  )
  const sanitizer = createStreamSanitizer(PROMPT_CANARY)
  let raw = ''
  let usage = NO_USAGE
  let meta: AnswerMeta | null = null
  let model: string | null = null
  let firstTokenAtMs: number | null = null
  const generationRequest = {
    name: 'answer',
    input: prompt.prompt,
    temperature: ANSWER_TEMPERATURE,
    maxOutputTokens: ANSWER_MAX_OUTPUT_TOKENS,
  } as const
  // O texto juntado é o já saneado: o que o usuário viu.
  const generation = trackGeneration(trace, generationRequest, deps.nowMs)
  // Sem `catch` não basta: o `return()` do consumidor (desconexão) só passa pelo `finally`.
  let interruption: string | null = 'aborted'
  let tail = ''

  try {
    for await (const event of deps.router.stream(
      {
        system: prompt.system,
        prompt: prompt.prompt,
        temperature: ANSWER_TEMPERATURE,
        maxOutputTokens: ANSWER_MAX_OUTPUT_TOKENS,
        signal: input.signal,
      },
      {
        zeroDataRetentionOnly: input.zeroDataRetention,
        onFailedAttempt: (attempt) => {
          recordFailedGeneration(trace, generationRequest, attempt)
        },
      },
    )) {
      if (event.type === 'start') {
        model = event.model
        generation.start(event)
        meta = {
          corpusVersion: await deps.corpusVersion(),
          retrievalMode: retrieval.mode,
          uncoveredFamilies: [...retrieval.uncoveredFamilies],
          provider: event.provider,
          fallbackFrom: event.fallbackFrom,
          cached: false,
        }
        yield { type: DataPartType.Meta, data: meta }
        for (const citation of citations) {
          yield { type: DataPartType.Citation, id: citation.id, data: citation }
        }
        yield { type: 'text-start', id: TEXT_PART_ID }
      } else if (event.type === 'text') {
        firstTokenAtMs ??= deps.nowMs()
        raw += event.text
        const safe = generation.text(sanitizer.push(event.text))
        if (safe !== '') {
          yield { type: 'text-delta', id: TEXT_PART_ID, delta: safe }
        }
      } else {
        usage = event.usage
      }
    }
    tail = generation.text(sanitizer.flush())
    interruption = null
  } catch (error) {
    interruption = interruptionOf(error, input.signal)
    throw error
  } finally {
    generation.end(usage, firstTokenAtMs, interruption)
  }
  if (tail !== '') {
    yield { type: 'text-delta', id: TEXT_PART_ID, delta: tail }
  }
  yield { type: 'text-end', id: TEXT_PART_ID }

  const base = {
    retrievalMode: retrieval.mode,
    provider: meta?.provider ?? null,
    model,
    usage,
    firstTokenAtMs,
  }
  const check = checkCitations(raw, prompt.sourceIds)
  const telemetry = deps.telemetry ?? noopTelemetry
  const corpusVersion = meta?.corpusVersion ?? null
  const insufficient = isInsufficient(raw)
  if (insufficient) {
    telemetry.insufficientSentinel(corpusVersion)
  }
  if (check.unknown.length > 0) {
    telemetry.citationsInvalidated(check.unknown.length, corpusVersion)
  }
  const reason =
    sanitizer.leaked || insufficient
      ? RefusalReason.ModelInsufficient
      : check.valid.length === 0
        ? RefusalReason.CitationInvalid
        : null
  if (reason !== null) {
    const refusal: Refusal = { reason }
    onOutcome({ ...base, answer: null, refusal })
    yield refusalChunk(refusal)
    return
  }
  const used = new Set(check.valid)
  const finalCitations = citations.map((citation) => ({
    ...citation,
    valid: used.has(citation.id),
  }))
  for (const citation of finalCitations.filter((item) => !item.valid)) {
    yield { type: DataPartType.Citation, id: citation.id, data: citation }
  }
  onOutcome({
    ...base,
    refusal: null,
    answer: {
      markdown: renderAnswerMarkdown(check.text),
      citations: finalCitations,
      meta: meta as AnswerMeta,
    },
  })
}
