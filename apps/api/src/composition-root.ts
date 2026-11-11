import { AppEnv } from '@teko/shared/contracts'
import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import type { HttpOptions, SpikeRouteOptions } from '#adapters/in/http/http-options.ts'
import { systemClock } from '#adapters/out/clock/system-clock.ts'
import { createLogger } from '#adapters/out/telemetry/logger.ts'
import type { Container } from '#app/container.ts'
import type { BackgroundTaskFailure } from '#app/ports/background-tasks.ts'
import type { Clock } from '#app/ports/clock.ts'
import { createLifecycle } from '#app/services/lifecycle.ts'
import { createStreamBudget } from '#app/services/stream-budget.ts'
import { createGetHealth } from '#app/use-cases/get-health.ts'
import { type BuildInfo, createBuildInfo } from '#domain/shared/build-info.ts'
import { buildApp } from './build-app.ts'
import { type Env, RuntimeTarget } from './config/env.ts'
import {
  createPlatformAdapters,
  platformNetwork,
  platformShutdown,
  type ShutdownProfile,
} from './config/platform.ts'

/**
 * Raiz de composição: o único módulo que conhece todas as camadas. A fiação é manual e tipada;
 * os adapters de plataforma vêm de `config/platform.ts` (`RUNTIME_TARGET`), e os de saída
 * (Postgres, LLM, embeddings...) entram aqui a partir da F2.
 */

export interface ContainerOverrides {
  readonly clock?: Clock
  /** Recebe falhas e estouros de teto das tarefas pós-resposta (padrão: descarta). */
  readonly onBackgroundFailure?: (failure: BackgroundTaskFailure) => void
}

function buildInfoOf(env: Env): BuildInfo {
  return createBuildInfo({ version: env.APP_VERSION, gitSha: env.GIT_SHA })
}

export function createContainer(env: Env, overrides: ContainerOverrides = {}): Container {
  const clock = overrides.clock ?? systemClock
  const buildInfo = buildInfoOf(env)
  const lifecycle = createLifecycle(clock)
  const platform = createPlatformAdapters(env, {
    onBackgroundFailure: overrides.onBackgroundFailure ?? (() => {}),
  })

  return {
    appEnv: env.APP_ENV,
    buildInfo,
    lifecycle,
    backgroundTasks: platform.backgroundTasks,
    clientIp: platform.clientIp,
    streamBudget: createStreamBudget(platform.invocationDeadline),
    useCases: {
      getHealth: createGetHealth({ buildInfo, appEnv: env.APP_ENV, lifecycle }),
    },
    // Nada a liberar na F1 (sem pool nem exporters); a F2 fecha o pool do Postgres aqui.
    close: async () => {},
  }
}

/**
 * Rotas `/api/_spike/*` dos spikes da F1: só em staging na Vercel, nunca em produção, no Render,
 * no CI ou local. Saem quando os spikes forem fechados (registro na ADR 0003).
 */
function spikeRouteOptions(env: Env): SpikeRouteOptions | undefined {
  if (env.APP_ENV !== AppEnv.Staging || env.RUNTIME_TARGET !== RuntimeTarget.Vercel) {
    return undefined
  }
  return {
    nodeVersion: process.version,
    region: env.VERCEL_REGION ?? null,
    maxDurationS: env.FUNCTION_MAX_DURATION_S,
    sensitiveLength: env.TEKO_SPIKE_SENSITIVE?.length ?? null,
    ...(env.NETLIFY_PROXY_JWS_SECRET === undefined
      ? {}
      : { proxySecret: env.NETLIFY_PROXY_JWS_SECRET }),
  }
}

export function createHttpOptions(env: Env): HttpOptions {
  const network = platformNetwork(env)
  const spike = spikeRouteOptions(env)
  return {
    webOrigin: env.WEB_ORIGIN,
    trustProxy: network.trustProxy,
    requestIdHeader: network.requestIdHeader,
    eventLoopDelayGuard: network.eventLoopDelayGuard,
    docs: env.APP_ENV !== AppEnv.Production,
    ...(spike === undefined ? {} : { spike }),
    // Sem `rateLimit`: o `PgRateLimitStore` (tabela `app.rate_limits`) chega com o schema, e
    // nenhuma rota da F1 abre transação. Memória local não serve com várias instâncias.
  }
}

/** Loga falhas de tarefas pós-resposta sem derrubar nada (o erro já foi contido no adapter). */
export function logBackgroundFailure(
  logger: FastifyBaseLogger,
): (failure: BackgroundTaskFailure) => void {
  return ({ name, outcome, error }) => {
    logger.warn({ task: name, outcome, err: error }, 'background task did not complete')
  }
}

export interface Runtime {
  readonly app: FastifyInstance
  readonly container: Container
  readonly shutdown: ShutdownProfile
}

/** Monta logger, container e app a partir de um env já validado (usado por `server.ts`). */
export async function createRuntime(env: Env): Promise<Runtime> {
  const buildInfo = buildInfoOf(env)
  const logger = createLogger({
    level: env.LOG_LEVEL,
    appEnv: env.APP_ENV,
    version: buildInfo.version,
    gitSha: buildInfo.gitSha,
    pretty: env.LOG_PRETTY,
  })
  const container = createContainer(env, { onBackgroundFailure: logBackgroundFailure(logger) })
  const app = await buildApp({ container, http: createHttpOptions(env), logger })
  return { app, container, shutdown: platformShutdown(env) }
}
