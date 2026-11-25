import type { AuthGateway } from '#app/ports/auth-gateway.ts'
import { lazyModule, type Preloadable } from '../lazy-module.ts'
import type { DrizzleDb } from '../persistence/drizzle/client.ts'
import { authMethodsOf, type BetterAuthConfig, clearCookieHeaders } from './auth-config.ts'

/**
 * `AuthGateway` do Better Auth com o SDK carregado sob demanda: os métodos de entrada e os cookies
 * de saída saem da configuração, e o `better-auth.ts` (Better Auth, passkey e adapter do Drizzle,
 * o maior pedaço do cold start) só é importado e instanciado na primeira chamada a `handle` ou
 * `getSession` (ou no `preload`). Depois disso, a mesma instância atende a vida inteira do
 * processo, como antes.
 */
export function createLazyBetterAuthGateway(
  db: DrizzleDb,
  config: BetterAuthConfig,
): AuthGateway & Preloadable {
  const gateway = lazyModule(async () => {
    const { createBetterAuthGateway } = await import('./better-auth.ts')
    return createBetterAuthGateway(db, config)
  })
  const clearing = clearCookieHeaders(config)
  return {
    methods: authMethodsOf(config),
    clearSessionCookies: () => clearing,
    handle: async (request) => (await gateway()).handle(request),
    getSession: async (headers, options) => (await gateway()).getSession(headers, options),
    preload: async () => {
      await gateway()
    },
  }
}
