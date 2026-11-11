import { AppEnv, HealthStatus, healthResponseSchema } from '@teko/shared/contracts'
import { describe, expect, it } from 'vitest'
import { createBuildInfo } from '#domain/shared/build-info.ts'
import { createLifecycle } from '../services/lifecycle.ts'
import { createGetHealth } from './get-health.ts'

const buildInfo = createBuildInfo({ version: '0.1.0', gitSha: 'abc1234' })

describe('createGetHealth', () => {
  it('reflete versão, SHA, ambiente e estado do processo', () => {
    const getHealth = createGetHealth({
      buildInfo,
      appEnv: AppEnv.Staging,
      lifecycle: { status: () => HealthStatus.Ok },
    })

    const health = getHealth()

    expect(health).toEqual({ status: 'ok', version: '0.1.0', gitSha: 'abc1234', env: 'staging' })
    expect(healthResponseSchema.parse(health)).toEqual(health)
  })

  it('passa a "draining" assim que o processo entra em drenagem', () => {
    const lifecycle = createLifecycle({ now: () => new Date(0) })
    const getHealth = createGetHealth({ buildInfo, appEnv: AppEnv.Production, lifecycle })

    expect(getHealth().status).toBe(HealthStatus.Ok)
    lifecycle.beginDraining()
    expect(getHealth().status).toBe(HealthStatus.Draining)
  })
})
