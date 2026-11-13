import closeWithGrace from 'close-with-grace'
import type { FastifyInstance } from 'fastify'
import type { Runtime } from './composition-root.ts'
import { EnvValidationError, loadEnv } from './config/env.ts'
import { createGracefulShutdown } from './graceful-shutdown.ts'

/**
 * Único entrypoint HTTP da API, sem mudança entre plataformas:
 *
 * - **Vercel** (`RUNTIME_TARGET=vercel`): o bundle deste módulo (`dist/server.mjs`) é o handler da
 *   única Function, em Fluid compute, no Build Output API montado por
 *   `scripts/build-vercel-output.ts` (ADR 0017). O launcher `Nodejs` da Vercel importa o módulo com
 *   `http.Server.prototype.listen` trocado por um interceptador que só captura o servidor e
 *   **não** abre a porta; depois do `import()` terminar, ele mesmo chama o `listen` real numa
 *   porta efêmera e encaminha as requisições. Por isso o boot (env, container, app, `ready`) é
 *   aguardado no topo do módulo, mas o `listen` não: aguardá-lo no topo travaria o `import()` para
 *   sempre (o evento `listening` só sai depois que o import termina). O runtime espera até 1 s
 *   pela captura depois do import; como o app já está pronto, o `listen` chega em microtarefas.
 * - **Render** (Plano B), **stack de CI**, **Docker** e **`pnpm dev`**: `node dist/server.mjs` (ou
 *   `node --watch src/server.ts`), com `listen` normal em `HOST:PORT`.
 *
 * Em todas, o encerramento no SIGTERM segue o perfil da plataforma (`graceful-shutdown.ts`).
 */

interface ListenAddress {
  readonly host: string
  readonly port: number
}

/** Abre a porta. Na Vercel, a promise só resolve depois que o runtime faz o `listen` real. */
async function listen(app: FastifyInstance, address: ListenAddress): Promise<void> {
  await app.listen(address)
}

function serve({ app, container, shutdown }: Runtime, address: ListenAddress): void {
  const graceful = closeWithGrace(
    { delay: shutdown.graceMs, logger: app.log },
    createGracefulShutdown({ app, container, profile: shutdown }),
  )
  listen(app, address).catch(async (error: unknown) => {
    graceful.uninstall()
    app.log.fatal({ err: error }, 'listen failed')
    await app.close()
    await container.close()
    process.exitCode = 1
  })
}

try {
  const env = loadEnv()
  // Import dinâmico do resto da app (plano, `server.ts`): a partir da F6, o SDK do OTel
  // (`instrumentation.ts`) e o do Sentry sobem aqui, antes de qualquer módulo instrumentado
  // (Fastify, `pg`) ser carregado. Até lá, só o env (e o `zod`) é carregado antes.
  const { createRuntime } = await import('./composition-root.ts')
  const runtime = await createRuntime(env)
  await runtime.app.ready()
  serve(runtime, { host: env.HOST, port: env.PORT })
} catch (error) {
  // Antes do logger existir (env inválido) só há stderr; a mensagem nunca inclui valores.
  console.error(error instanceof EnvValidationError ? error.message : error)
  process.exitCode = 1
}
