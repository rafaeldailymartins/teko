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
import type { StoredReferenceInput } from '../ports/question-repository.ts'
import {
  ANSWER_MAX_OUTPUT_TOKENS,
  ANSWER_TEMPERATURE,
  buildAnswerPrompt,
  PROMPT_CANARY,
} from '../prompts/answer.ts'
import type { ProviderRouter } from '../services/provider-router.ts'
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
  const retrieval = await deps.retrieveEvidence({
    input: input.referenceInput,
    source: input.referenceSource,
    questionText: input.question,
    families: input.families,
    locale: input.locale,
    signal: input.signal,
  })
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

  for await (const event of deps.router.stream(
    {
      system: prompt.system,
      prompt: prompt.prompt,
      temperature: ANSWER_TEMPERATURE,
      maxOutputTokens: ANSWER_MAX_OUTPUT_TOKENS,
      signal: input.signal,
    },
    { zeroDataRetentionOnly: input.zeroDataRetention },
  )) {
    if (event.type === 'start') {
      model = event.model
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
      const safe = sanitizer.push(event.text)
      if (safe !== '') {
        yield { type: 'text-delta', id: TEXT_PART_ID, delta: safe }
      }
    } else {
      usage = event.usage
    }
  }
  const tail = sanitizer.flush()
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
  const reason =
    sanitizer.leaked || isInsufficient(raw)
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
