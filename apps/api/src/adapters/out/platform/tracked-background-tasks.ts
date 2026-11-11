import type {
  BackgroundTaskFailure,
  BackgroundTaskOptions,
  BackgroundTasks,
} from '#app/ports/background-tasks.ts'
import { BackgroundTaskOutcome } from '#app/ports/background-tasks.ts'

/**
 * Núcleo comum dos adapters de `BackgroundTasks`: cada tarefa ganha um teto (`timeoutMs`), nunca
 * rejeita, informa falha ou estouro ao observador e fica registrada até terminar, para o
 * encerramento poder esperá-la (`drain`).
 *
 * `extendLifetime` é o gancho da plataforma: na Vercel, o `waitUntil`; fora dela, nada.
 */
export interface TrackedBackgroundTasksDeps {
  readonly onFailure: (failure: BackgroundTaskFailure) => void
  readonly extendLifetime?: (settled: Promise<void>) => void
}

const TIMED_OUT = Symbol('timed-out')

function withTimeout(task: Promise<unknown>, timeoutMs: number): Promise<unknown> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(resolve, timeoutMs, TIMED_OUT)
    timer.unref()
  })
  return Promise.race([task, timeout]).finally(() => clearTimeout(timer))
}

export function createTrackedBackgroundTasks(deps: TrackedBackgroundTasksDeps): BackgroundTasks {
  const inFlight = new Set<Promise<void>>()

  const report = (failure: BackgroundTaskFailure): void => {
    try {
      deps.onFailure(failure)
    } catch {
      // O observador nunca derruba a tarefa nem o processo.
    }
  }

  return {
    run(name: string, task: Promise<unknown>, { timeoutMs }: BackgroundTaskOptions): void {
      const settled = withTimeout(task, timeoutMs).then(
        (result) => {
          if (result === TIMED_OUT) {
            report({ name, outcome: BackgroundTaskOutcome.TimedOut })
          }
        },
        (error: unknown) => {
          report({ name, outcome: BackgroundTaskOutcome.Failed, error })
        },
      )
      const tracked = settled.finally(() => {
        inFlight.delete(tracked)
      })
      inFlight.add(tracked)
      deps.extendLifetime?.(tracked)
    },

    pending: () => inFlight.size,

    async drain(timeoutMs: number): Promise<number> {
      if (inFlight.size > 0) {
        await withTimeout(Promise.all(inFlight), timeoutMs)
      }
      return inFlight.size
    },
  }
}
