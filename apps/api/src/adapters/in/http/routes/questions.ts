import { PassThrough } from 'node:stream'
import {
  askQuestionRequestSchema,
  askQuestionResponseSchema,
  encodeSseChunk,
  feedbackRequestSchema,
  historyQuerySchema,
  historyResponseSchema,
  questionDetailSchema,
  questionIdParamsSchema,
  quotaResponseSchema,
  SSE_DONE,
  SSE_HEARTBEAT,
  type TekoStreamChunk,
  UI_MESSAGE_STREAM_HEADERS,
} from '@teko/shared/contracts'
import { problemDetailsSchema } from '@teko/shared/errors'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { QuestionUseCases } from '#app/container.ts'
import { requireOnboardedSession, requireSession } from '../plugins/auth.ts'

/**
 * Perguntas (`/api/v1/questions*`) e a cota do dia (`/api/v1/me/quota`). O stream sai em SSE com os
 * cabeçalhos do UI Message Stream v1, um heartbeat `: hb` a cada 15 s e o `[DONE]` no fim. A
 * desconexão do cliente aborta o sinal da resposta (e o LLM), e a iteração para.
 */
const HEARTBEAT_MS = 15_000

const ERRORS = {
  400: problemDetailsSchema,
  401: problemDetailsSchema,
  403: problemDetailsSchema,
  404: problemDetailsSchema,
  409: problemDetailsSchema,
  429: problemDetailsSchema,
  451: problemDetailsSchema,
  503: problemDetailsSchema,
}

/** Corpo do stream: vazio (`{}`); a pergunta já está gravada. */
const streamBodySchema = z.strictObject({}).optional()

/** Escreve os chunks em SSE num `PassThrough`, com heartbeat; para quando o cliente sai. */
function sseStream(
  chunks: AsyncIterable<TekoStreamChunk>,
  heartbeatMs: number = HEARTBEAT_MS,
): PassThrough {
  const out = new PassThrough()
  const heartbeat = setInterval(() => {
    if (!out.destroyed) {
      out.write(SSE_HEARTBEAT)
    }
  }, heartbeatMs)
  void (async () => {
    try {
      for await (const chunk of chunks) {
        if (out.destroyed) {
          break
        }
        out.write(encodeSseChunk(chunk))
      }
      if (!out.destroyed) {
        out.end(SSE_DONE)
      }
    } catch {
      out.destroy()
    } finally {
      clearInterval(heartbeat)
    }
  })()
  return out
}

export const questionRoutes: FastifyPluginAsyncZod = async (app) => {
  function questions(): QuestionUseCases {
    const useCases = app.container.useCases.questions
    if (useCases === null) {
      throw app.httpErrors.serviceUnavailable()
    }
    return useCases
  }

  app.post(
    '/api/v1/questions',
    {
      config: { rateLimit: false },
      schema: {
        operationId: 'askQuestion',
        summary: 'Faz uma pergunta numa data de referência',
        tags: ['questions'],
        body: askQuestionRequestSchema,
        response: { 200: askQuestionResponseSchema, ...ERRORS },
      },
    },
    async (request) => {
      const session = await requireOnboardedSession(request)
      return questions().ask({
        user: session.user,
        request: request.body,
        requestId: request.id,
        requestCountry: app.container.geo.countryOf(request.headers),
      })
    },
  )

  app.post(
    '/api/v1/questions/:id/stream',
    {
      config: { rateLimit: false },
      schema: {
        operationId: 'streamAnswer',
        summary: 'Resposta em UI Message Stream v1 (SSE); um stream por pergunta',
        description:
          '200 em text/event-stream (chunks do UI Message Stream v1); erros antes do stream em problem+json (401, 404, 409 stream_busy, 503).',
        tags: ['questions'],
        params: questionIdParamsSchema,
        body: streamBodySchema,
      },
    },
    async (request, reply) => {
      const startedAtMs = Date.now()
      const session = await requireSession(request)
      const disconnected = new AbortController()
      reply.raw.on('close', () => {
        if (!reply.raw.writableFinished) {
          disconnected.abort(new Error('client disconnected'))
        }
      })
      const chunks = await questions().stream({
        user: session.user,
        questionId: request.params.id,
        signal: disconnected.signal,
        startedAtMs,
        traceId: request.id,
      })
      return reply
        .headers({ ...UI_MESSAGE_STREAM_HEADERS, 'x-trace-id': request.id })
        .send(sseStream(chunks))
    },
  )

  app.get(
    '/api/v1/questions',
    {
      config: { rateLimit: {} },
      schema: {
        operationId: 'listHistory',
        summary: 'Histórico de uma conversa',
        tags: ['questions'],
        querystring: historyQuerySchema,
        response: { 200: historyResponseSchema, ...ERRORS },
      },
    },
    async (request) => {
      const session = await requireSession(request)
      return questions().history.list(session.user.id, request.query.conversationId)
    },
  )

  app.get(
    '/api/v1/questions/:id',
    {
      config: { rateLimit: {} },
      schema: {
        operationId: 'getQuestion',
        summary: 'Uma pergunta, com a resposta ou a recusa',
        tags: ['questions'],
        params: questionIdParamsSchema,
        response: { 200: questionDetailSchema, ...ERRORS },
      },
    },
    async (request) => {
      const session = await requireSession(request)
      return questions().history.get(session.user.id, request.params.id)
    },
  )

  app.post(
    '/api/v1/questions/:id/feedback',
    {
      config: { rateLimit: {} },
      schema: {
        operationId: 'recordFeedback',
        summary: 'Polegar e motivo (inclusive citação errada)',
        tags: ['questions'],
        params: questionIdParamsSchema,
        body: feedbackRequestSchema,
        response: { 204: z.null(), ...ERRORS },
      },
    },
    async (request, reply) => {
      const session = await requireSession(request)
      await questions().history.recordFeedback(session.user.id, request.params.id, request.body)
      return reply.code(204).send(null)
    },
  )

  app.get(
    '/api/v1/me/quota',
    {
      config: { rateLimit: false },
      schema: {
        operationId: 'getQuota',
        summary: 'Cota de perguntas do dia',
        tags: ['me'],
        response: { 200: quotaResponseSchema, ...ERRORS },
      },
    },
    async (request) => {
      const session = await requireSession(request)
      return questions().history.quota(session.user.id)
    },
  )
}
