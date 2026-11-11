import cors from '@fastify/cors'
import type { FastifyPluginAsync } from 'fastify'

/**
 * Escopo do stream (`POST /api/v1/questions/:id/stream`), o único endpoint que o navegador chama
 * direto na API, fora do proxy same-origin da Netlify. Só ele tem CORS: as demais rotas passam
 * pelo proxy e não precisam (nem devem) responder a origens externas.
 *
 * O CORS fica encapsulado neste escopo; a rota do stream entra aqui na F4. A origem é exata
 * (sem curingas) e não há credenciais: a autenticação é o ticket em `Authorization: Bearer`.
 */
export const STREAM_PREFIX = '/api/v1/questions/:id/stream'

const STREAM_CORS_ALLOWED_HEADERS = [
  'authorization',
  'content-type',
  'traceparent',
  'tracestate',
  'baggage',
  'sentry-trace',
] as const

const STREAM_CORS_EXPOSED_HEADERS = ['x-trace-id', 'x-vercel-ai-ui-message-stream'] as const

export const STREAM_CORS_MAX_AGE_SECONDS = 600

export interface StreamScopeOptions {
  readonly webOrigin: string
}

export const streamScope: FastifyPluginAsync<StreamScopeOptions> = async (scope, options) => {
  await scope.register(cors, {
    origin: [options.webOrigin],
    methods: ['POST'],
    credentials: false,
    maxAge: STREAM_CORS_MAX_AGE_SECONDS,
    allowedHeaders: [...STREAM_CORS_ALLOWED_HEADERS],
    exposedHeaders: [...STREAM_CORS_EXPOSED_HEADERS],
    strictPreflight: true,
  })
}
