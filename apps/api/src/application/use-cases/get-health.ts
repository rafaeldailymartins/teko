import type { AppEnv, HealthResponse } from '@teko/shared/contracts'
import type { BuildInfo } from '#domain/shared/build-info.ts'
import type { Lifecycle } from '../services/lifecycle.ts'

/**
 * Liveness do processo (`GET /healthz`). Regra do plano (CU-h no Neon): **nunca** toca o banco
 * nem qualquer dependência externa. O Synthetic Monitoring do Grafana (a cada 5 min,
 * `infra/grafana/synthetic-monitoring/checks.json`), o smoke do deploy e os healthchecks do Caddy
 * (stack de CI) e do Render batem aqui; se isso acordasse o Neon, o scale-to-zero nunca
 * aconteceria.
 */
export type GetHealth = () => HealthResponse

export interface GetHealthDeps {
  readonly buildInfo: BuildInfo
  readonly appEnv: AppEnv
  readonly lifecycle: Pick<Lifecycle, 'status'>
}

export function createGetHealth({ buildInfo, appEnv, lifecycle }: GetHealthDeps): GetHealth {
  return () => ({
    status: lifecycle.status(),
    version: buildInfo.version,
    gitSha: buildInfo.gitSha,
    env: appEnv,
  })
}
