import type { FeedbackRating, FeedbackReason } from '@teko/shared/contracts'
import { ErrorCode } from '@teko/shared/errors'
import { deleteConversation, getQuestion, recordFeedback } from './__generated__/sdk.gen.ts'
import type { GetQuestionResponse } from './__generated__/types.gen.ts'
import { apiClient } from './client.ts'
import { ApiError } from './errors.ts'

/**
 * Chamadas pontuais do chat e do histórico fora do cache de consultas. Erros chegam como `ApiError` (interceptor
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
 * Exclui uma conversa com as perguntas, respostas e avaliações dela:
 * `DELETE /v1/conversations/:id`. Um 404 conta como sucesso: a conversa já não existe (excluída em
 * outra aba, por exemplo), e o resultado para quem pediu é o mesmo. O resto (inclusive o 409
 * `stream_busy`, com uma resposta ainda em andamento) chega como `ApiError`.
 */
export async function removeConversation(conversationId: string): Promise<void> {
  try {
    await deleteConversation({
      client: apiClient,
      throwOnError: true,
      path: { id: conversationId },
    })
  } catch (error) {
    if (!(error instanceof ApiError && error.code === ErrorCode.NotFound)) {
      throw error
    }
  }
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
