import { setTimeout as sleep } from 'node:timers/promises'
import type { FastifyInstance } from 'fastify'
import type { Container } from '#app/container.ts'
import type { ShutdownProfile } from './config/platform.ts'

/**
 * Encerramento no SIGTERM, com tetos do perfil de plataforma (`config/platform.ts`):
 *
 * 1. entra em drenagem: `/healthz` passa a responder 503 (e, na F4, novos streams também);
 * 2. espera `drainDelayMs` para o proxy da frente (o Caddy da stack de CI)
 *    ver o 503 antes de a porta fechar; na Vercel é 0;
 * 3. `app.close()`: para de aceitar conexões, responde 503 às novas e espera as ativas (na F4,
 *    os streams terminam em no máximo 100 s);
 * 4. espera as tarefas pós-resposta (`BackgroundTasks`) por até `backgroundDrainMs`;
 * 5. libera os recursos do container (pool do Postgres a partir da F2) e, em paralelo, encerra a
 *    telemetria (flush final de traces, logs e métricas), com o mesmo teto `backgroundDrainMs`
 *    (300 ms na Vercel: cabe no `forceFlush` ≤ 400 ms do plano).
 *
 * O teto total é o `delay` do close-with-grace (`graceMs`): 450 ms na Vercel, que dá 500 ms no
 * scale-down; `SHUTDOWN_GRACE_MS` (≥ 30 s) fora dela. Na Vercel, cada deploy é uma deployment
 * imutável nova e os streams em curso terminam na antiga, então não há drenagem a fazer. Em erro
 * fatal (`uncaughtException`/`unhandledRejection`) não há espera: o processo fecha já.
 */
export interface ShutdownEvent {
  readonly signal?: string
  readonly err?: Error
}

export interface GracefulShutdownDeps {
  readonly app: Pick<FastifyInstance, 'close' | 'log'>
  readonly container: Pick<Container, 'lifecycle' | 'backgroundTasks' | 'close'>
  readonly profile: Pick<ShutdownProfile, 'drainDelayMs' | 'backgroundDrainMs'>
  /** SDK do OTel (`instrumentation.ts`); ausente nos testes. */
  readonly telemetry?: { shutdown(): Promise<void> }
  readonly wait?: (ms: number) => Promise<unknown>
}

/** Espera `work` por até `timeoutMs`; `false` se o teto venceu antes. */
async function within(work: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const expired = new Promise<false>((resolve) => {
    timer = setTimeout(resolve, timeoutMs, false)
  })
  try {
    return await Promise.race([work.then(() => true), expired])
  } finally {
    clearTimeout(timer)
  }
}

export function createGracefulShutdown({
  app,
  container,
  profile,
  telemetry,
  wait = sleep,
}: GracefulShutdownDeps): (event: ShutdownEvent) => Promise<void> {
  const { drainDelayMs, backgroundDrainMs } = profile
  return async ({ signal, err }) => {
    container.lifecycle.beginDraining()
    if (err === undefined) {
      app.log.info({ signal, drainDelayMs }, 'shutdown requested; draining')
      if (drainDelayMs > 0) {
        await wait(drainDelayMs)
      }
    } else {
      app.log.fatal({ err }, 'fatal error; shutting down')
    }
    await app.close()
    const abandoned = await container.backgroundTasks.drain(backgroundDrainMs)
    if (abandoned > 0) {
      app.log.warn({ abandoned }, 'background tasks still pending at shutdown')
    }
    const [, telemetryFlushed] = await Promise.all([
      container.close(),
      telemetry === undefined ? true : within(telemetry.shutdown(), backgroundDrainMs),
    ])
    if (!telemetryFlushed) {
      app.log.warn({ timeoutMs: backgroundDrainMs }, 'telemetry flush did not finish at shutdown')
    }
    app.log.info({ drainedForMs: container.lifecycle.drainingForMs() }, 'shutdown complete')
  }
}
