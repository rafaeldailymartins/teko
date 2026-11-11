import type { FastifyInstance } from 'fastify'
import type { Container } from '#app/container.ts'

declare module 'fastify' {
  interface FastifyInstance {
    /** Container de casos de uso (`createContainer(env)` em `composition-root.ts`). */
    readonly container: Container
  }
}

/** Expõe o container para as rotas via `app.container` (decorator do Fastify). */
export function decorateContainer(app: FastifyInstance, container: Container): void {
  app.decorate('container', container)
}
