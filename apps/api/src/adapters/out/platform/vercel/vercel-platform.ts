import { ipAddress, waitUntil } from '@vercel/functions'
import type { BackgroundTaskFailure, BackgroundTasks } from '#app/ports/background-tasks.ts'
import {
  type ClientIp,
  ClientIpSource,
  ClientPath,
  type RequestHeaders,
} from '#app/ports/client-ip.ts'
import type { InvocationDeadline } from '#app/ports/invocation-deadline.ts'
import { NO_CLIENT_IP, proxiedClientIp, singleIpHeader } from '../client-ip-headers.ts'
import { createTrackedBackgroundTasks } from '../tracked-background-tasks.ts'

/**
 * Adapters de plataforma da Vercel (`RUNTIME_TARGET=vercel`). Único lugar do código que importa
 * `@vercel/functions` (regra do dependency-cruiser), fixado em 3.7.6: a última versão publicada
 * com proveniência SLSA, exigida pelo `trustPolicy: no-downgrade` do pnpm. Ela exporta
 * `waitUntil`, `ipAddress`, `geolocation`, `attachDatabasePool` e `getContext`, mas não
 * `getDeadline` (ver `createVercelInvocationDeadline`).
 */

/**
 * Cada tarefa vai para o `waitUntil` da invocação corrente. Fora de uma invocação da Vercel (sem
 * o contexto de requisição no `globalThis`), o `waitUntil` não faz nada e a tarefa só é
 * acompanhada, como no Node. O registro local serve ao SIGTERM do scale-down (500 ms).
 */
export function createVercelBackgroundTasks(
  onFailure: (failure: BackgroundTaskFailure) => void,
  extendLifetime: (settled: Promise<void>) => void = waitUntil,
): BackgroundTasks {
  return createTrackedBackgroundTasks({ onFailure, extendLifetime })
}

/** Adapta o objeto de headers do Node à interface `Headers.get` que o `@vercel/functions` espera. */
function headersLike(headers: RequestHeaders): { get(name: string): string | null } {
  return { get: (name) => singleIpHeader(headers, name) }
}

/**
 * - Direto: `x-real-ip` (via `ipAddress`), que a borda da Vercel sobrescreve e nunca repassa do
 *   cliente. É também o motivo de o `trustProxy` ser de exatamente 1 salto.
 * - Proxiado: o IP de rede é o de saída da Netlify; vale a regra comum do
 *   `x-nf-client-connection-ip`.
 */
export function createVercelClientIp(options: {
  readonly trustNetlifyClientIp: boolean
}): ClientIp {
  return {
    resolve(input) {
      if (input.path === ClientPath.Proxied) {
        return proxiedClientIp(input, options.trustNetlifyClientIp)
      }
      const ip = ipAddress(headersLike(input.headers))
      return ip === undefined ? NO_CLIENT_IP : { ip, source: ClientIpSource.Platform }
    },
  }
}

/**
 * Prazo da invocação = início + `maxDuration` configurado (o `functions[...].maxDuration` do
 * `vercel.json`, ou o padrão do Hobby, 300 s). Substitui o `getDeadline()`, ausente na 3.7.6; o
 * valor configurado precisa acompanhar o `vercel.json` (`FUNCTION_MAX_DURATION_S`).
 */
export function createVercelInvocationDeadline(maxDurationMs: number): InvocationDeadline {
  return {
    deadlineFor: (startedAtMs) => startedAtMs + maxDurationMs,
  }
}
