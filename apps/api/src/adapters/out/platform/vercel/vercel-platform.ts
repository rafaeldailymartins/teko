import { attachDatabasePool, ipAddress, waitUntil } from '@vercel/functions'
import type { BackgroundTaskFailure, BackgroundTasks } from '#app/ports/background-tasks.ts'
import { type ClientIp, ClientIpSource, type RequestHeaders } from '#app/ports/client-ip.ts'
import type { InvocationDeadline } from '#app/ports/invocation-deadline.ts'
import { NO_CLIENT_IP, singleIpHeader } from '../client-ip-headers.ts'
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

/** Pool aceito pelo `attachDatabasePool` (o `pg.Pool` satisfaz). */
export type AttachablePool = Parameters<typeof attachDatabasePool>[0]

/**
 * Mantém a instância viva só o bastante para fechar as conexões ociosas do pool antes de suspender
 * (Fluid compute). Sem isso, conexões do `pg` ficam penduradas no PgBouncer do Neon entre
 * invocações. Fora de uma invocação da Vercel é no-op.
 */
export function vercelAttachDatabasePool(
  pool: AttachablePool,
  attach: (pool: AttachablePool) => void = attachDatabasePool,
): void {
  attach(pool)
}

/** Adapta o objeto de headers do Node à interface `Headers.get` que o `@vercel/functions` espera. */
function headersLike(headers: RequestHeaders): { get(name: string): string | null } {
  return { get: (name) => singleIpHeader(headers, name) }
}

/**
 * `x-real-ip` (via `ipAddress`), que a borda da Vercel sobrescreve e nunca repassa do cliente. É
 * também o motivo de o `trustProxy` ser de exatamente 1 salto. Web e API estão na mesma origem
 * (ADR 0029): todo navegador chega direto à borda, então o IP vale em todas as rotas.
 */
export function createVercelClientIp(): ClientIp {
  return {
    resolve(input) {
      const ip = ipAddress(headersLike(input.headers))
      return ip === undefined ? NO_CLIENT_IP : { ip, source: ClientIpSource.Platform }
    },
  }
}

/**
 * Prazo da invocação = início + `maxDuration` da Function (o `.vc-config.json` gerado por
 * `scripts/build-vercel-output.ts`). Substitui o `getDeadline()`, ausente na 3.7.6; o valor vem de
 * `FUNCTION_MAX_DURATION_S`, obrigatória com `RUNTIME_TARGET=vercel` e conferida contra o
 * `.vc-config.json` pelo teste do script.
 */
export function createVercelInvocationDeadline(maxDurationMs: number): InvocationDeadline {
  return {
    deadlineFor: (startedAtMs) => startedAtMs + maxDurationMs,
  }
}
