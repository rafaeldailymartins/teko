import { isIP } from 'node:net'
import type { BackgroundTaskFailure, BackgroundTasks } from '#app/ports/background-tasks.ts'
import { type ClientIp, ClientIpSource } from '#app/ports/client-ip.ts'
import type { GeoResolver } from '#app/ports/geo-resolver.ts'
import type { InvocationDeadline } from '#app/ports/invocation-deadline.ts'
import { NO_CLIENT_IP } from '../client-ip-headers.ts'
import { createTrackedBackgroundTasks } from '../tracked-background-tasks.ts'

/**
 * Adapters de plataforma para um processo Node comum: `RUNTIME_TARGET=node` (local, stack de CI,
 * Docker) e `RUNTIME_TARGET=render` (Plano B). O processo vive além da resposta, então as tarefas
 * pós-resposta só são acompanhadas e o encerramento gracioso as espera.
 */
export function createNodeBackgroundTasks(
  onFailure: (failure: BackgroundTaskFailure) => void,
): BackgroundTasks {
  return createTrackedBackgroundTasks({ onFailure })
}

/**
 * O IP é o que o Fastify calculou (`request.ip`) com o `trustProxy` da plataforma: a rede do proxy
 * da stack de CI e localhost no dev, o valor medido no ensaio no Render.
 */
export function createNodeClientIp(): ClientIp {
  return {
    resolve(input) {
      return isIP(input.forwardedIp) === 0
        ? NO_CLIENT_IP
        : { ip: input.forwardedIp, source: ClientIpSource.TrustedProxy }
    },
  }
}

/** Processo comum: o pool vive com o processo e fecha no encerramento gracioso. */
export function nodeAttachDatabasePool(_pool: unknown): void {}

/** Processo comum: nenhum prazo de invocação imposto pela plataforma. */
export const nodeInvocationDeadline: InvocationDeadline = {
  deadlineFor: () => null,
}

/** Fora da Vercel não há país da requisição confiável: vale só o país declarado. */
export const nodeGeoResolver: GeoResolver = { countryOf: () => null }
