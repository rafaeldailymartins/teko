import {
  createNodeBackgroundTasks,
  createNodeClientIp,
  nodeInvocationDeadline,
} from '#adapters/out/platform/node/node-platform.ts'
import {
  createVercelBackgroundTasks,
  createVercelClientIp,
  createVercelInvocationDeadline,
} from '#adapters/out/platform/vercel/vercel-platform.ts'
import type { BackgroundTaskFailure, BackgroundTasks } from '#app/ports/background-tasks.ts'
import type { ClientIp } from '#app/ports/client-ip.ts'
import type { InvocationDeadline } from '#app/ports/invocation-deadline.ts'
import {
  CADDY_NETWORK_APP_ENVS,
  DEFAULT_TRUST_PROXY,
  type Env,
  RuntimeTarget,
  type TrustProxy,
} from './env.ts'

/**
 * Perfil de plataforma: lê `RUNTIME_TARGET` (`vercel | render | node`) e escolhe os adapters de
 * `adapters/out/platform`. O mesmo `server.ts` roda nas três; nada fora daqui (e da raiz de
 * composição) sabe em qual está.
 *
 * O `attachDatabasePool` (só na Vercel) entra aqui com o pool do Postgres, na F2.
 */

/**
 * `x-nf-client-connection-ip` só passa a valer quando o spike F1 (c) provar que a Netlify
 * sobrescreve o valor enviado pelo cliente. Até lá, no caminho proxiado, nenhum IP é confiável e a
 * chave de rate limit é a sessão. Mudar isto exige o resultado do spike registrado em `docs/adr/`.
 */
export const NETLIFY_CLIENT_IP_TRUSTED = false

/** Na Vercel, a borda sobrescreve `X-Forwarded-For`/`x-real-ip`: confia-se em exatamente 1 salto. */
const VERCEL_TRUST_PROXY_HOPS = 1

/**
 * SIGTERM no scale-down da Vercel: 500 ms de prazo. O encerramento inteiro fica em 450 ms e as
 * tarefas pós-resposta têm até 300 ms (o `forceFlush` de OTel/Langfuse da F6 cabe em 400 ms).
 */
export const VERCEL_SHUTDOWN = { drainDelayMs: 0, graceMs: 450, backgroundDrainMs: 300 } as const

/** Fora da Vercel, as tarefas pós-resposta têm até 5 s depois que o servidor fechou. */
export const NODE_BACKGROUND_DRAIN_MS = 5000

/** Header com o request id da borda (ou do Caddy); `null` = sempre um UUID próprio. */
const REQUEST_ID_HEADER = {
  [RuntimeTarget.Vercel]: 'x-vercel-id',
  [RuntimeTarget.Node]: 'x-request-id',
  // O Render repassa `X-Request-Id` do cliente sem sobrescrever: não serve de correlação.
  [RuntimeTarget.Render]: null,
} as const satisfies Record<RuntimeTarget, string | null>

export interface ShutdownProfile {
  /** Espera com `/healthz` em 503 antes de fechar a porta. */
  readonly drainDelayMs: number
  /** Teto do encerramento inteiro (`delay` do close-with-grace). */
  readonly graceMs: number
  /** Teto da espera pelas tarefas pós-resposta, depois que o servidor fechou. */
  readonly backgroundDrainMs: number
}

/** Parte de rede do perfil, sem adapters (alimenta as opções do Fastify). */
export interface PlatformNetwork {
  readonly trustProxy: TrustProxy
  readonly requestIdHeader: string | null
}

/**
 * Fora da Vercel: o valor medido (`TRUST_PROXY`) ou, só em development e ci, a rede do Caddy.
 * `parseEnv` já impede o resto (Render exige `TRUST_PROXY`; `node` é proibido em staging e
 * produção); este guarda impede que um `Env` montado de outro jeito caia no padrão do CI.
 */
function nonVercelTrustProxy(env: Env): TrustProxy {
  if (env.TRUST_PROXY !== undefined) {
    return env.TRUST_PROXY
  }
  if (!CADDY_NETWORK_APP_ENVS.has(env.APP_ENV)) {
    throw new Error(
      `TRUST_PROXY ausente com APP_ENV=${env.APP_ENV}: o padrão (rede do Caddy) só vale em development e ci`,
    )
  }
  return [DEFAULT_TRUST_PROXY]
}

export function platformNetwork(env: Env): PlatformNetwork {
  return {
    trustProxy:
      env.RUNTIME_TARGET === RuntimeTarget.Vercel
        ? VERCEL_TRUST_PROXY_HOPS
        : nonVercelTrustProxy(env),
    requestIdHeader: REQUEST_ID_HEADER[env.RUNTIME_TARGET],
  }
}

export function platformShutdown(env: Env): ShutdownProfile {
  return env.RUNTIME_TARGET === RuntimeTarget.Vercel
    ? VERCEL_SHUTDOWN
    : {
        drainDelayMs: env.DRAIN_DELAY_MS,
        graceMs: env.SHUTDOWN_GRACE_MS,
        backgroundDrainMs: NODE_BACKGROUND_DRAIN_MS,
      }
}

/** Adapters de saída que dependem da plataforma. */
export interface PlatformAdapters {
  readonly backgroundTasks: BackgroundTasks
  readonly clientIp: ClientIp
  readonly invocationDeadline: InvocationDeadline
}

export interface PlatformDeps {
  readonly onBackgroundFailure: (failure: BackgroundTaskFailure) => void
}

export function createPlatformAdapters(env: Env, deps: PlatformDeps): PlatformAdapters {
  const ipOptions = { trustNetlifyClientIp: NETLIFY_CLIENT_IP_TRUSTED }
  if (env.RUNTIME_TARGET === RuntimeTarget.Vercel) {
    return {
      backgroundTasks: createVercelBackgroundTasks(deps.onBackgroundFailure),
      clientIp: createVercelClientIp(ipOptions),
      invocationDeadline: createVercelInvocationDeadline(env.FUNCTION_MAX_DURATION_S * 1000),
    }
  }
  return {
    backgroundTasks: createNodeBackgroundTasks(deps.onBackgroundFailure),
    clientIp: createNodeClientIp(ipOptions),
    invocationDeadline: nodeInvocationDeadline,
  }
}
