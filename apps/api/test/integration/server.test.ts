import { readFileSync } from 'node:fs'
import { Server } from 'node:http'
import { afterAll, describe, expect, it, vi } from 'vitest'

/**
 * `src/server.ts` como o runtime da Vercel o carrega (zero-config Fastify, `@vercel/node`):
 *
 * 1. troca `http.Server.prototype.listen` por um interceptador que só captura o servidor (não
 *    abre porta nem chama callback);
 * 2. faz `import()` do entrypoint e espera o módulo avaliar;
 * 3. se o servidor ainda não foi capturado, espera até 1 s;
 * 4. restaura o `listen` e o chama de verdade numa porta efêmera, encaminhando as requisições.
 *
 * Se o `server.ts` aguardasse o `listen` no topo do módulo, o passo 2 nunca terminaria. Este teste
 * reproduz esse protocolo (lido do builder da Vercel CLI 65.11.0) e precisa ser revisto se o spike
 * F1 (b) mostrar outro comportamento.
 */

/** Regex com que o builder `@vercel/fastify` confirma que o entrypoint importa o Fastify. */
const VERCEL_FASTIFY_IMPORT = /(?:from|require|import)\s*(?:\(\s*)?["']fastify["']\s*(?:\))?/g
const CAPTURE_WAIT_MS = 1000

let captured: Server | undefined

afterAll(async () => {
  vi.unstubAllEnvs()
  if (captured?.listening === true) {
    captured.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      captured?.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

describe('server.ts no runtime da Vercel', () => {
  it('é reconhecido como entrypoint Fastify pelo builder zero-config', () => {
    const source = readFileSync(new URL('../../src/server.ts', import.meta.url), 'utf8')
    expect(source.match(VERCEL_FASTIFY_IMPORT)).not.toBeNull()
  })

  it('termina o import sem abrir porta, entrega o servidor e atende depois do listen real', async () => {
    vi.stubEnv('APP_ENV', 'ci')
    vi.stubEnv('WEB_ORIGIN', 'https://develop--teko-web.netlify.app')
    vi.stubEnv('RUNTIME_TARGET', 'vercel')
    vi.stubEnv('LOG_LEVEL', 'silent')
    vi.stubEnv('GIT_SHA', 'abc1234')

    const originalListen = Server.prototype.listen
    let onCapture: () => void = () => {}
    const intercept = function (this: Server): Server {
      captured = this
      Server.prototype.listen = originalListen
      onCapture()
      return this
    }
    Server.prototype.listen = intercept as typeof originalListen

    try {
      await import('../../src/server.ts')
      if (captured === undefined) {
        await new Promise<void>((resolve) => {
          onCapture = resolve
          setTimeout(resolve, CAPTURE_WAIT_MS)
        })
      }
    } finally {
      Server.prototype.listen = originalListen
    }

    const server = captured
    if (server === undefined) {
      throw new Error('o runtime não capturou o servidor em até 1 s depois do import')
    }
    expect(server.listening).toBe(false)

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('o servidor deveria escutar em uma porta TCP')
    }
    const base = `http://127.0.0.1:${address.port}`

    const health = await fetch(`${base}/healthz`, {
      headers: { 'x-vercel-id': 'gru1::gru1::8lfqm-1762780000000-0a1b2c3d4e5f' },
    })
    expect(health.status).toBe(200)
    expect(health.headers.get('x-request-id')).toBe('gru1::gru1::8lfqm-1762780000000-0a1b2c3d4e5f')
    expect(await health.json()).toMatchObject({ status: 'ok', gitSha: 'abc1234', env: 'ci' })

    const missing = await fetch(`${base}/api/v1/nada`)
    expect(missing.status).toBe(404)
    expect(missing.headers.get('content-type')).toContain('application/problem+json')
  })
})
