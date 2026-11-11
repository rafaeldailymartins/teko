import { z } from 'zod'
import { appEnvSchema } from './common.ts'

/**
 * `GET /healthz` (direto) e `GET /api/healthz` (proxy). Nunca toca o banco. Em drenagem
 * (SIGTERM) responde 503 com `status: 'draining'`.
 */
export const HealthStatus = {
  Ok: 'ok',
  Draining: 'draining',
} as const
export type HealthStatus = (typeof HealthStatus)[keyof typeof HealthStatus]

export const healthResponseSchema = z
  .object({
    status: z.enum(HealthStatus),
    /** Versão do release (`0.1.0`) ou `0.0.0-<sha7>` no staging. */
    version: z.string().min(1),
    /** SHA do commit da imagem; o deploy faz polling até `gitSha == sha`. */
    gitSha: z.union([z.string().regex(/^[0-9a-f]{7,40}$/), z.literal('unknown')]),
    env: appEnvSchema,
  })
  .meta({ description: 'Estado do processo da API (sem dependências externas)' })

export type HealthResponse = z.infer<typeof healthResponseSchema>
