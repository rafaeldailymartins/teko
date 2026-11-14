import type { HealthStatus as HealthStatusType } from '@teko/shared/contracts'
import { AppEnv, HealthStatus } from '@teko/shared/contracts'
import Fastify, { type FastifyInstance } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Container } from '#app/container.ts'
import { decorateContainer } from '../plugins/container.ts'
import { healthRoutes } from './health.ts'

let status: HealthStatusType = HealthStatus.Ok
let calls = 0
let app: FastifyInstance

const container: Container = {
  appEnv: AppEnv.Ci,
  buildInfo: { version: '0.1.0', gitSha: 'abc1234' },
  lifecycle: {
    status: () => status,
    isDraining: () => status === HealthStatus.Draining,
    beginDraining: () => true,
    drainingForMs: () => null,
  },
  useCases: {
    getHealth: () => {
      calls += 1
      return { status, version: '0.1.0', gitSha: 'abc1234', env: AppEnv.Ci }
    },
    resolveReferenceDate: () => {
      throw new Error('fora do escopo deste teste')
    },
    retrieval: null,
    users: null,
    questions: null,
  },
  auth: null,
  backgroundTasks: { run: () => {}, pending: () => 0, drain: async () => 0 },
  clientIp: { resolve: () => ({ ip: null, source: 'none' }) },
  geo: { countryOf: () => null },
  rateLimitStore: null,
  streamBudget: { timeoutMs: () => 100_000 },
  close: async () => {},
}

beforeAll(async () => {
  app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  decorateContainer(app, container)
  await app.register(healthRoutes)
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe('healthRoutes', () => {
  it.each(['/healthz', '/api/healthz'])('%s devolve 200 com o estado do processo', async (url) => {
    status = HealthStatus.Ok
    const before = calls
    const res = await app.inject({ url })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok', version: '0.1.0', gitSha: 'abc1234', env: 'ci' })
    expect(calls).toBe(before + 1)
  })

  it.each(['/healthz', '/api/healthz'])('%s devolve 503 em drenagem', async (url) => {
    status = HealthStatus.Draining
    const res = await app.inject({ url })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toMatchObject({ status: 'draining' })
  })
})
