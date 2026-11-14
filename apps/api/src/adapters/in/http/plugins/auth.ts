import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  type AuthGateway,
  type AuthSession,
  CLIENT_IP_HEADER,
  type GetSessionOptions,
} from '#app/ports/auth-gateway.ts'

/**
 * Better Auth na mesma origem (ADR 0029): `/api/auth/*` vira um `Request` da Fetch API e volta
 * como resposta do Fastify, com todos os `Set-Cookie`. As rotas da aplicação leem a sessão por
 * `sessionOf(request)`, com memo por requisição.
 *
 * O IP do cliente chega ao Better Auth (rate limit dele, em banco) por um header interno, com o
 * valor da porta `ClientIp` da plataforma; o mesmo header vindo do cliente é descartado.
 */
const AUTH_PREFIX = '/api/auth'

declare module 'fastify' {
  interface FastifyRequest {
    /** Memo da sessão desta requisição (cache do cookie). */
    authSessionMemo?: Promise<AuthSession | null>
  }
}

function webHeaders(request: FastifyRequest): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || name === CLIENT_IP_HEADER) {
      continue
    }
    for (const item of [value].flat()) {
      headers.append(name, item)
    }
  }
  return headers
}

function authGateway(request: FastifyRequest): AuthGateway {
  const { auth } = request.server.container
  if (auth === null) {
    throw request.server.httpErrors.serviceUnavailable()
  }
  return auth
}

/**
 * Sessão da requisição (`null` sem sessão). `fresh` lê do banco, ignorando o `cookieCache`, e não
 * usa o memo.
 */
export function sessionOf(
  request: FastifyRequest,
  options: GetSessionOptions = {},
): Promise<AuthSession | null> {
  const auth = authGateway(request)
  if (options.fresh === true) {
    return auth.getSession(webHeaders(request), options)
  }
  request.authSessionMemo ??= auth.getSession(webHeaders(request))
  return request.authSessionMemo
}

/** Sessão obrigatória: sem ela, 401 `unauthenticated`. */
export async function requireSession(
  request: FastifyRequest,
  options: GetSessionOptions = {},
): Promise<AuthSession> {
  const session = await sessionOf(request, options)
  if (session === null) {
    throw request.server.httpErrors.unauthorized('Authentication required')
  }
  return session
}

/**
 * Sessão de usuário com onboarding concluído: sem ele, 403 `onboarding_required`. Se o cache do
 * cookie (até 5 min) ainda diz "pendente", relê do banco antes de recusar: o onboarding acabou de
 * ser concluído em outra requisição.
 */
export async function requireOnboardedSession(request: FastifyRequest): Promise<AuthSession> {
  const users = request.server.container.useCases.users
  if (users === null) {
    throw request.server.httpErrors.serviceUnavailable()
  }
  const cached = await requireSession(request)
  try {
    users.requireOnboarded(cached.user)
    return cached
  } catch {
    const fresh = await requireSession(request, { fresh: true })
    users.requireOnboarded(fresh.user)
    return fresh
  }
}

function toRequest(request: FastifyRequest): Request {
  const headers = webHeaders(request)
  const { ip } = request.server.container.clientIp.resolve({
    headers: request.headers,
    forwardedIp: request.ip,
  })
  if (ip !== null) {
    headers.set(CLIENT_IP_HEADER, ip)
  }
  const url = new URL(request.url, request.server.authBaseUrl)
  const hasBody =
    request.method !== 'GET' && request.method !== 'HEAD' && request.body !== undefined
  return new Request(url, {
    method: request.method,
    headers,
    ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
  })
}

async function sendResponse(reply: FastifyReply, response: Response): Promise<FastifyReply> {
  reply.code(response.status)
  for (const [name, value] of response.headers) {
    // O `no-store` de `/api/*` vale também aqui; os cookies vão um por um.
    if (name !== 'set-cookie' && name !== 'cache-control') {
      reply.header(name, value)
    }
  }
  const cookies = response.headers.getSetCookie()
  if (cookies.length > 0) {
    reply.header('set-cookie', cookies)
  }
  return reply.send(response.body === null ? null : await response.text())
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Origem do ambiente: base das URLs repassadas ao Better Auth. */
    readonly authBaseUrl: string
  }
}

export async function registerAuth(
  app: FastifyInstance,
  options: { readonly webOrigin: string },
): Promise<void> {
  app.decorate('authBaseUrl', options.webOrigin)
  app.route({
    method: ['GET', 'POST'],
    url: `${AUTH_PREFIX}/*`,
    schema: { hide: true },
    handler: async (request, reply) => {
      const response = await authGateway(request).handle(toRequest(request))
      return sendResponse(reply, response)
    },
  })
}
