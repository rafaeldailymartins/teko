import type { AppEnv } from '@teko/shared/contracts'
import type { BuildInfo } from '#domain/shared/build-info.ts'
import type { BackgroundTasks } from './ports/background-tasks.ts'
import type { ClientIp } from './ports/client-ip.ts'
import type { Lifecycle } from './services/lifecycle.ts'
import type { StreamBudget } from './services/stream-budget.ts'
import type { GetHealth } from './use-cases/get-health.ts'

/** Casos de uso expostos aos adapters de entrada (HTTP agora; CLI a partir da F3). */
interface UseCases {
  readonly getHealth: GetHealth
}

/**
 * Container de dependências montado à mão em `composition-root.ts` (`createContainer(env)`).
 * Os adapters de entrada só conhecem este contrato, nunca os adapters de saída.
 */
export interface Container {
  readonly appEnv: AppEnv
  readonly buildInfo: BuildInfo
  readonly useCases: UseCases
  readonly lifecycle: Lifecycle
  /** Trabalho pós-resposta (`waitUntil` na Vercel; promise acompanhada fora dela). */
  readonly backgroundTasks: BackgroundTasks
  /** IP do cliente conforme a plataforma e o caminho (direto ou proxiado). */
  readonly clientIp: ClientIp
  /** Teto de cada stream, descontado o prazo da invocação (F4). */
  readonly streamBudget: StreamBudget
  /** Libera recursos (pool do Postgres, exporters...) depois que o servidor HTTP fechou. */
  close(): Promise<void>
}
