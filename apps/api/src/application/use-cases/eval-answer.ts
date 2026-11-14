import type { TekoStreamChunk } from '@teko/shared/contracts'
import type { Locale } from '@teko/shared/i18n'
import { redact } from '@teko/shared/pii'
import type { ReferenceSource } from '@teko/shared/vigencia'
import type { StoredReferenceInput } from '../ports/question-repository.ts'
import {
  type AnswerOutcome,
  type AnswerPipelineDeps,
  runAnswerPipeline,
} from './answer-pipeline.ts'

/**
 * Resposta completa sem sessão, cota nem persistência, para as evals de geração e o red team da
 * stack de CI (`POST /api/v1/_eval/answer`, só com `APP_ENV=ci`). Usa o mesmo pipeline do stream,
 * com a pergunta redigida e o mesmo teto de tempo.
 */
interface EvalAnswerCommand {
  readonly question: string
  readonly referenceInput: StoredReferenceInput
  readonly referenceSource: ReferenceSource
  readonly families: readonly string[]
  readonly locale: Locale
  readonly zeroDataRetention: boolean
}

interface EvalAnswerResult {
  readonly chunks: readonly TekoStreamChunk[]
  readonly outcome: AnswerOutcome | null
}

export type EvalAnswer = (command: EvalAnswerCommand) => Promise<EvalAnswerResult>

export function createEvalAnswer(
  deps: AnswerPipelineDeps & { readonly timeoutMs: number },
): EvalAnswer {
  return async (command) => {
    const chunks: TekoStreamChunk[] = []
    let outcome: AnswerOutcome | null = null
    for await (const chunk of runAnswerPipeline(
      deps,
      {
        messageId: 'eval',
        question: redact(command.question).text,
        referenceInput: command.referenceInput,
        referenceSource: command.referenceSource,
        families: command.families,
        locale: command.locale,
        zeroDataRetention: command.zeroDataRetention,
        signal: AbortSignal.timeout(deps.timeoutMs),
      },
      (value) => {
        outcome = value
      },
    )) {
      chunks.push(chunk)
    }
    return { chunks, outcome }
  }
}
