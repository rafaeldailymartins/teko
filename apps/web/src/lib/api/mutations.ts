import type { FeedbackRating, FeedbackReason } from '@teko/shared/contracts'
import { getQuestion, recordFeedback } from './__generated__/sdk.gen.ts'
import type { GetQuestionResponse } from './__generated__/types.gen.ts'
import { apiClient } from './client.ts'

/**
 * Chamadas pontuais do chat fora do cache de consultas. Erros chegam como `ApiError` (interceptor
 * do `apiClient`); mutações não repetem.
 */

export interface FeedbackInput {
  readonly questionId: string
  readonly rating: FeedbackRating
  readonly reason?: FeedbackReason
}

/** Polegar (e motivo) de uma resposta: `POST /v1/questions/:id/feedback`. */
export async function submitFeedback({ questionId, rating, reason }: FeedbackInput): Promise<void> {
  await recordFeedback({
    client: apiClient,
    throwOnError: true,
    path: { id: questionId },
    body: reason === undefined ? { rating } : { rating, reason },
  })
}

/**
 * Releitura de uma pergunta depois que o stream caiu (não há resume): `GET /v1/questions/:id`, sem
 * passar pelo cache, porque o estado gravado muda enquanto a API termina a resposta.
 */
export async function rereadQuestion(questionId: string): Promise<GetQuestionResponse> {
  const { data } = await getQuestion({
    client: apiClient,
    throwOnError: true,
    path: { id: questionId },
  })
  return data
}
