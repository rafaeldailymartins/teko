import {
  createStreamErrorChunk,
  StoredQuestionStatus,
  type TekoStreamChunk,
} from '@teko/shared/contracts'
import { ErrorCode } from '@teko/shared/errors'
import { ApplicationError } from '../errors.ts'
import type { SessionUser } from '../ports/auth-gateway.ts'
import type { BackgroundTasks } from '../ports/background-tasks.ts'
import type { Clock } from '../ports/clock.ts'
import type {
  ClaimedQuestion,
  QuestionRepository,
  StreamResult,
  UsageReservation,
} from '../ports/question-repository.ts'
import {
  AnswerOutcomeKind,
  type AnswerSignal,
  noopTelemetry,
  type Telemetry,
} from '../ports/telemetry.ts'
import { PROMPT_VERSION } from '../prompts/answer.ts'
import type { Lifecycle } from '../services/lifecycle.ts'
import { shadowCostUsd } from '../services/pricing.ts'
import type { StreamBudget } from '../services/stream-budget.ts'
import {
  disabledQueryTracer,
  type QueryTrace,
  type QueryTracer,
  untracedQuery,
} from '../services/trace-sampler.ts'
import {
  type AnswerOutcome,
  type AnswerPipelineDeps,
  runAnswerPipeline,
} from './answer-pipeline.ts'

/**
 * `StreamAnswer` (`POST /api/v1/questions/:id/stream`): claim atômico `pending → streaming` (zero
 * linhas → 409 `stream_busy`), depois o pipeline da resposta com teto próprio de
 * `min(100 s, prazo − agora − 20 s)` e o sinal da desconexão. Antes do `finish`, uma transação curta
 * grava a resposta, acerta a reserva de `stream_seconds` pelo uso real e guarda o cache.
 *
 * - teto estourado → `error` `upstream_unavailable` (retryable), pergunta `failed`;
 * - cadeia de LLM fora do ar → `error` com o código dela, pergunta `failed`;
 * - desconexão → o LLM é abortado pelo sinal e `aborted` é gravado em `BackgroundTasks`; a cota
 *   consumida não volta.
 *
 * O trace `rag-query` (Langfuse) começa logo depois do claim, ainda no contexto da requisição (o
 * mesmo `trace_id` do OTel), se o `TraceSampler` amostrar a pergunta; o `trace_id` e as units vão
 * na mesma transação da resposta, em todos os desfechos.
 */
interface StreamAnswerCommand {
  readonly user: SessionUser
  readonly questionId: string
  /** Aborta quando o cliente desconecta. */
  readonly signal: AbortSignal
  /** Início da invocação (para o prazo da plataforma). */
  readonly startedAtMs: number
  readonly traceId: string
}

export type StreamAnswer = (command: StreamAnswerCommand) => Promise<AsyncIterable<TekoStreamChunk>>

export interface StreamAnswerDeps {
  readonly questions: QuestionRepository
  readonly pipeline: AnswerPipelineDeps
  readonly clock: Clock
  readonly streamBudget: StreamBudget
  readonly lifecycle: Pick<Lifecycle, 'isDraining'>
  readonly backgroundTasks: BackgroundTasks
  readonly reservation: UsageReservation
  readonly cacheTtlMs: number
  /** Métricas do desfecho e da chamada de LLM (padrão: nenhuma). */
  readonly telemetry?: Telemetry
  /** Traces de LLM (padrão: nenhum). */
  readonly tracer?: QueryTracer
}

/** Teto do stream estourado (o sinal do timer aborta com isto). */
export class StreamTimeoutError extends Error {
  constructor() {
    super('stream timeout')
    this.name = 'StreamTimeoutError'
  }
}

/** Teto para gravar `aborted` depois da desconexão (tarefa pós-resposta). */
const ABORT_RECORD_TIMEOUT_MS = 2000
const NO_MODEL = 'none'

interface Timing {
  readonly startedMs: number
  readonly endedMs: number
}

/**
 * Resultado sem resposta (falha, desconexão): sem LLM que tenha respondido, o custo-sombra é 0. A
 * coluna `shadow_cost_usd` é sempre gravada, em todos os desfechos.
 */
function baseResult(timing: Timing, trace: QueryTrace): Omit<StreamResult, 'status'> {
  return {
    answerMarkdown: null,
    citations: [],
    meta: null,
    refusal: null,
    retrievalMode: null,
    provider: null,
    model: null,
    promptVersion: PROMPT_VERSION,
    corpusVersion: null,
    inputTokens: 0,
    outputTokens: 0,
    shadowCostUsd: 0,
    ttftMs: null,
    latencyMs: timing.endedMs - timing.startedMs,
    streamSeconds: Math.max(1, Math.ceil((timing.endedMs - timing.startedMs) / 1000)),
    cache: null,
    langfuseTraceId: trace.traceId,
    langfuseUnits: trace.units(),
  }
}

export function resultOf(
  question: ClaimedQuestion,
  outcome: AnswerOutcome,
  timing: Timing,
  cacheTtlMs: number,
  trace: QueryTrace = untracedQuery,
): StreamResult {
  const answered = outcome.answer !== null
  return {
    ...baseResult(timing, trace),
    status: answered ? StoredQuestionStatus.Answered : StoredQuestionStatus.Refused,
    answerMarkdown: outcome.answer?.markdown ?? null,
    citations: outcome.answer?.citations ?? [],
    meta: outcome.answer?.meta ?? null,
    refusal: outcome.refusal,
    retrievalMode: outcome.retrievalMode,
    provider: outcome.provider,
    model: outcome.model,
    corpusVersion: outcome.answer?.meta.corpusVersion ?? question.corpusVersion,
    inputTokens: outcome.usage.inputTokens,
    outputTokens: outcome.usage.outputTokens,
    shadowCostUsd: shadowCostUsd(outcome.model, outcome.usage),
    ttftMs: outcome.firstTokenAtMs === null ? null : outcome.firstTokenAtMs - timing.startedMs,
    cache:
      outcome.answer !== null && question.cacheKey !== null
        ? {
            key: question.cacheKey,
            answer: outcome.answer,
            expiresAt: new Date(timing.endedMs + cacheTtlMs),
          }
        : null,
  }
}

function errorCodeOf(error: unknown, timedOut: boolean): ErrorCode {
  if (timedOut) {
    return ErrorCode.UpstreamUnavailable
  }
  if (error instanceof ApplicationError) {
    return error.problem.code
  }
  return ErrorCode.Internal
}

function unansweredSignal(
  outcome: typeof AnswerOutcomeKind.Failed | typeof AnswerOutcomeKind.Aborted,
  question: ClaimedQuestion,
): AnswerSignal {
  return {
    outcome,
    refusalReason: null,
    retrievalMode: null,
    cached: false,
    corpusVersion: question.corpusVersion,
  }
}

/** Sinais de uma resposta gravada: o desfecho e, se um modelo respondeu, a chamada de LLM. */
export function recordOutcome(
  telemetry: Telemetry,
  outcome: AnswerOutcome,
  result: StreamResult,
): void {
  telemetry.answer({
    outcome: outcome.answer === null ? AnswerOutcomeKind.Refused : AnswerOutcomeKind.Answered,
    refusalReason: outcome.refusal?.reason ?? null,
    retrievalMode: outcome.retrievalMode,
    cached: false,
    corpusVersion: result.corpusVersion,
  })
  if (outcome.provider !== null && outcome.model !== null) {
    telemetry.llmCall({
      provider: outcome.provider,
      model: outcome.model,
      ttftSeconds: result.ttftMs === null ? null : result.ttftMs / 1000,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      shadowCostUsd: result.shadowCostUsd,
    })
  }
}

/** Fecha o trace sem resposta (falha ou desconexão). */
function endUnanswered(
  trace: QueryTrace,
  outcome: typeof AnswerOutcomeKind.Failed | typeof AnswerOutcomeKind.Aborted,
  question: ClaimedQuestion,
  endedAtMs: number,
): void {
  trace.end({
    outcome,
    refusalReason: null,
    answer: null,
    citations: 0,
    corpusVersion: question.corpusVersion,
    endedAtMs,
  })
}

export function createStreamAnswer(deps: StreamAnswerDeps): StreamAnswer {
  const nowMs = (): number => deps.clock.now().getTime()
  const telemetry = deps.telemetry ?? noopTelemetry
  const tracer = deps.tracer ?? disabledQueryTracer

  async function* run(
    command: StreamAnswerCommand,
    question: ClaimedQuestion,
    trace: QueryTrace,
  ): AsyncGenerator<TekoStreamChunk> {
    const startedMs = nowMs()
    const timer = new AbortController()
    const handle = setTimeout(
      () => timer.abort(new StreamTimeoutError()),
      deps.streamBudget.timeoutMs(command.startedAtMs, startedMs),
    )
    const signal = AbortSignal.any([command.signal, timer.signal])
    let outcome: AnswerOutcome | null = null
    let recorded = false
    try {
      yield* runAnswerPipeline(
        deps.pipeline,
        {
          messageId: question.id,
          question: question.questionRedacted,
          referenceInput: question.referenceInput,
          referenceSource: question.referenceSource,
          families: question.families,
          locale: question.locale,
          zeroDataRetention: question.zeroDataRetention,
          signal,
          trace,
        },
        (value) => {
          outcome = value
        },
      )
      // O pipeline sempre entrega o resultado antes de terminar sem exceção.
      const done = outcome as unknown as AnswerOutcome
      const endedMs = nowMs()
      trace.end({
        outcome: done.answer === null ? AnswerOutcomeKind.Refused : AnswerOutcomeKind.Answered,
        refusalReason: done.refusal?.reason ?? null,
        answer: done.answer?.markdown ?? null,
        citations: done.answer?.citations.filter((citation) => citation.valid).length ?? 0,
        corpusVersion: done.answer?.meta.corpusVersion ?? question.corpusVersion,
        endedAtMs: endedMs,
      })
      const result = resultOf(question, done, { startedMs, endedMs }, deps.cacheTtlMs, trace)
      await deps.questions.finish(question.id, deps.reservation, result)
      recorded = true
      recordOutcome(telemetry, done, result)
      yield {
        type: 'finish',
        messageMetadata: {
          usage: { ...done.usage },
          model: done.model ?? NO_MODEL,
          traceId: command.traceId,
        },
      }
    } catch (error) {
      if (command.signal.aborted && !timer.signal.aborted) {
        // O cliente saiu: ninguém lê o `error`; o `finally` grava `aborted`.
        return
      }
      const endedMs = nowMs()
      endUnanswered(trace, AnswerOutcomeKind.Failed, question, endedMs)
      await deps.questions.finish(question.id, deps.reservation, {
        ...baseResult({ startedMs, endedMs }, trace),
        status: StoredQuestionStatus.Failed,
      })
      recorded = true
      telemetry.answer(unansweredSignal(AnswerOutcomeKind.Failed, question))
      yield createStreamErrorChunk(errorCodeOf(error, timer.signal.aborted))
    } finally {
      clearTimeout(handle)
      if (!recorded) {
        const endedMs = nowMs()
        endUnanswered(trace, AnswerOutcomeKind.Aborted, question, endedMs)
        telemetry.answer(unansweredSignal(AnswerOutcomeKind.Aborted, question))
        deps.backgroundTasks.run(
          'question-aborted',
          deps.questions.finish(question.id, deps.reservation, {
            ...baseResult({ startedMs, endedMs }, trace),
            status: StoredQuestionStatus.Aborted,
          }),
          { timeoutMs: ABORT_RECORD_TIMEOUT_MS },
        )
      }
    }
  }

  return async (command) => {
    if (deps.lifecycle.isDraining()) {
      throw new ApplicationError({ code: ErrorCode.ServicePaused })
    }
    const claim = await deps.questions.claim(command.questionId, command.user.id)
    if (claim.kind === 'not_found') {
      throw new ApplicationError({ code: ErrorCode.NotFound, detail: 'Question not found' })
    }
    if (claim.kind === 'busy') {
      throw new ApplicationError({ code: ErrorCode.StreamBusy })
    }
    const { question } = claim
    const trace = await tracer.start({
      questionId: question.id,
      userId: command.user.id,
      question: question.questionRedacted,
      locale: question.locale,
      families: question.families,
      referenceDate: question.referenceDate,
      referenceSource: question.referenceSource,
      corpusVersion: question.corpusVersion,
      promptVersion: PROMPT_VERSION,
      cached: false,
      startedAtMs: nowMs(),
    })
    return run(command, question, trace)
  }
}
