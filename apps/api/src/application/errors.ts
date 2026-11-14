import type { ProblemInit } from '@teko/shared/errors'

/**
 * Erro da aplicação com código do contrato (`ErrorCode`): o error handler HTTP o converte em
 * problem+json com o mesmo código, sem depender do status (403 pode ser `forbidden` ou
 * `onboarding_required`; 429 pode ser `rate_limited` ou `quota_exceeded`, que exige `meta`).
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type ApplicationProblem = DistributiveOmit<ProblemInit, 'traceId' | 'instance'>

export class ApplicationError extends Error {
  readonly problem: ApplicationProblem

  constructor(problem: ApplicationProblem) {
    super(problem.detail ?? problem.code)
    this.name = 'ApplicationError'
    this.problem = problem
  }
}
