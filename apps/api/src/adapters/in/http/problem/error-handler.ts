import { PROBLEM_CONTENT_TYPE, type ProblemDetails } from '@teko/shared/errors'
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
  return { traceId: request.id, instance: path }
}

function sendProblem(reply: FastifyReply, problem: ProblemDetails): FastifyReply {
  return reply.code(problem.status).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(problem))
}

/**
 * Alternativa ao problem+json no 404 (o site estático do Plano B, ADR 0029): devolve a resposta,
 * ou `null` para seguir com o problem+json.
 */
export type NotFoundFallback = (request: FastifyRequest, reply: FastifyReply) => FastifyReply | null

export function registerProblemHandlers(
  app: FastifyInstance,
  notFoundFallback: NotFoundFallback = () => null,
): void {
  app.setErrorHandler((error, request, reply) => {
    const problem = problemFromError(error, contextOf(request))
    if (problem.status >= 500) {
      request.log.error({ err: error, code: problem.code }, 'request failed')
    } else {
      request.log.info({ code: problem.code, status: problem.status }, 'request rejected')
    }
    return sendProblem(reply, problem)
  })

  app.setNotFoundHandler(
    (request, reply) =>
      notFoundFallback(request, reply) ??
      sendProblem(reply, notFoundProblem(request.method, contextOf(request))),
  )
}
