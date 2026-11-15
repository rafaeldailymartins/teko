import { describe, expect, it } from 'vitest'
import { termsVersionSchema } from '../contracts/onboarding.ts'
import { PRIVACY_POLICY_VERSION, TERMS_VERSION } from './index.ts'

describe('versões dos textos legais', () => {
  it.each([
    ['TERMS_VERSION', TERMS_VERSION],
    ['PRIVACY_POLICY_VERSION', PRIVACY_POLICY_VERSION],
  ])('%s é uma data ISO aceita pelo contrato do onboarding', (_name, version) => {
    expect(version).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(termsVersionSchema.safeParse(version).success).toBe(true)
  })
})
