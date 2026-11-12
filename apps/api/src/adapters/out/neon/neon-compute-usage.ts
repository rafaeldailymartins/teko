import { z } from 'zod'
import type { ComputeUsageMeter } from '#app/ports/database-usage.ts'

/**
 * CU-segundos do projeto Neon pela API v2: `GET https://console.neon.tech/api/v2/projects/{id}`
 * devolve `project.compute_time_seconds`, o acumulado do período de cobrança (aproximado e com
 * algum atraso; serve para monitorar, não para faturar). A ingestão lê no início e no fim do run e
 * grava a diferença em `ingestion_runs.cu_seconds`.
 *
 * Host fixo; a chave (`NEON_API_KEY_STAGING`) vai só no header. Sem chave ou projeto, o medidor
 * devolve `null` sem chamar nada.
 */

const NEON_API_HOST = 'console.neon.tech'
const PROJECT_ID = /^[a-z0-9-]{1,64}$/

const projectSchema = z.object({
  project: z.object({ compute_time_seconds: z.number().nonnegative() }),
})

export interface NeonComputeUsageOptions {
  readonly apiKey: string | undefined
  readonly projectId: string | undefined
  readonly fetch?: typeof fetch
  /** Teto da chamada (a medição é informativa: não pode segurar o run). */
  readonly timeoutMs?: number
}

export function neonProjectUrl(projectId: string): URL {
  if (!PROJECT_ID.test(projectId)) {
    throw new RangeError('NEON_STAGING_PROJECT_ID inválido')
  }
  return new URL(`https://${NEON_API_HOST}/api/v2/projects/${projectId}`)
}

export function createNeonComputeUsage(options: NeonComputeUsageOptions): ComputeUsageMeter {
  const { apiKey, projectId } = options
  if (apiKey === undefined || projectId === undefined) {
    return { computeSeconds: () => Promise.resolve(null) }
  }
  const url = neonProjectUrl(projectId)
  const doFetch = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 10_000
  return {
    async computeSeconds() {
      const response = await doFetch(url, {
        headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        return null
      }
      const parsed = projectSchema.safeParse(await response.json())
      return parsed.success ? parsed.data.project.compute_time_seconds : null
    },
  }
}
