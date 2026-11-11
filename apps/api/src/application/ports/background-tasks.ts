/**
 * Trabalho depois da resposta (flush de telemetria, gravação de `aborted` após desconexão...).
 * É a única forma permitida de trabalho pós-resposta.
 *
 * - Na Vercel, a tarefa vai para o `waitUntil`: a invocação continua viva até ela terminar, mas o
 *   `waitUntil` divide o prazo da invocação, é cancelado no fim dele e mantém a memória
 *   provisionada cobrando enquanto roda. Por isso toda tarefa tem teto próprio (`timeoutMs`).
 * - No Render, no CI e local, a promise só é acompanhada, e o encerramento gracioso a espera
 *   (`drain`).
 *
 * Uma tarefa nunca derruba o processo: erro ou estouro do teto vira um `BackgroundTaskFailure`
 * entregue ao observador configurado na raiz de composição.
 */
export interface BackgroundTaskOptions {
  /** Teto da tarefa, em ms (o plano usa 500 ms para cada flush de telemetria). */
  readonly timeoutMs: number
}

export interface BackgroundTasks {
  /** Agenda a promise (já iniciada) como tarefa pós-resposta. Nunca lança. */
  run(name: string, task: Promise<unknown>, options: BackgroundTaskOptions): void
  /** Quantas tarefas ainda não terminaram. */
  pending(): number
  /**
   * Espera as tarefas pendentes por até `timeoutMs` (encerramento). Devolve quantas continuavam
   * pendentes ao fim da espera.
   */
  drain(timeoutMs: number): Promise<number>
}

export const BackgroundTaskOutcome = {
  Failed: 'failed',
  TimedOut: 'timed_out',
} as const
export type BackgroundTaskOutcome =
  (typeof BackgroundTaskOutcome)[keyof typeof BackgroundTaskOutcome]

export interface BackgroundTaskFailure {
  readonly name: string
  readonly outcome: BackgroundTaskOutcome
  /** Presente só em `failed`. */
  readonly error?: unknown
}
