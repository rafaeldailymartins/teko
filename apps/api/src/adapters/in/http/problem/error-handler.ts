import { ErrorCode, PROBLEM_CONTENT_TYPE, type ProblemDetails } from '@teko/shared/errors'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { notFoundProblem, type ProblemContext, problemFromError } from './problem-mapper.ts'

/**
 * Error handler RFC 9457: toda falha sai como `application/problem+json` com `code` e `traceId`.
 * Uma recusa (fora de cobertura, sem evidência...) não é erro HTTP e nunca passa por aqui.
 *
 * O corpo é serializado aqui mesmo (string), para não depender do schema de resposta da rota:
 * um erro numa rota que só declara 200 continuaria saindo como problem+json válido.
 */

function contextOf(request: FastifyRequest): ProblemContext {
  const queryStart = request.url.indexOf('?')
  const path = queryStart === -1 ? request.url : request.url.slice(0, queryStart)
  // Antes do hook de telemetria (erro no parse da requisição), o request id faz as vezes.
  return { traceId: request.traceId || request.id, instance: path }
}

function sendProblem(reply: FastifyReply, problem: ProblemDetails): FastifyReply {
  return reply.code(problem.status).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(problem))
}

/**
 * Chamado para cada erro inesperado (`internal`, 500), depois do log: o destino de erros
 * (`report-error.ts`). Os 4xx esperados (validação, sessão, cota) e os 503 deliberados
 * (`service_paused` do kill switch ou do `under-pressure`, `upstream_unavailable`, que já têm
 * métricas e alertas próprios) nunca passam por aqui.
 */
export type UnexpectedErrorHook = (error: unknown, request: FastifyRequest, status: number) => void

export function registerProblemHandlers(
  app: FastifyInstance,
  onUnexpectedError: UnexpectedErrorHook = () => {},
): void {
  app.setErrorHandler((error, request, reply) => {
    const problem = problemFromError(error, contextOf(request))
    if (problem.status >= 500) {
      request.log.error({ err: error, code: problem.code }, 'request failed')
      if (problem.code === ErrorCode.Internal) {
        try {
          onUnexpectedError(error, request, problem.status)
        } catch {
          // O relato do erro nunca troca a resposta.
        }
      }
    } else {
      request.log.info({ code: problem.code, status: problem.status }, 'request rejected')
    }
    return sendProblem(reply, problem)
  })

  app.setNotFoundHandler((request, reply) =>
    sendProblem(reply, notFoundProblem(request.method, contextOf(request))),
  )
}
