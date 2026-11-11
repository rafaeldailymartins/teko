import { isIP } from 'node:net'
import type { BackgroundTaskFailure, BackgroundTasks } from '#app/ports/background-tasks.ts'
import { type ClientIp, ClientIpSource, ClientPath } from '#app/ports/client-ip.ts'
import type { InvocationDeadline } from '#app/ports/invocation-deadline.ts'
import { NO_CLIENT_IP, proxiedClientIp } from '../client-ip-headers.ts'
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
 * No caminho direto, o IP é o que o Fastify calculou (`request.ip`) com o `trustProxy` da
 * plataforma: a rede do Caddy no CI e local, o valor medido no ensaio no Render. No proxiado,
 * vale a regra comum do `x-nf-client-connection-ip`.
 */
export function createNodeClientIp(options: { readonly trustNetlifyClientIp: boolean }): ClientIp {
  return {
    resolve(input) {
      if (input.path === ClientPath.Proxied) {
        return proxiedClientIp(input, options.trustNetlifyClientIp)
      }
      return isIP(input.forwardedIp) === 0
        ? NO_CLIENT_IP
        : { ip: input.forwardedIp, source: ClientIpSource.TrustedProxy }
    },
  }
}

/** Processo comum: nenhum prazo de invocação imposto pela plataforma. */
export const nodeInvocationDeadline: InvocationDeadline = {
  deadlineFor: () => null,
}
