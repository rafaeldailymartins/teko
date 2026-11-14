import { describe, expect, it, vi } from 'vitest'
import { ApplicationError } from '../errors.ts'
import type { SessionUser } from '../ports/auth-gateway.ts'
import type { UserRepository } from '../ports/user-repository.ts'
import { createUserUseCases, isOnboarded, toMe } from './users.ts'

const TERMS = '2026-11-14'
const NOW = new Date('2026-11-10T15:00:00Z')

const ONBOARDED: SessionUser = {
  id: '0195f3c4-0000-7000-8000-000000000001',
  name: 'Ana',
  email: 'ana@example.com',
  image: null,
  isAdult: true,
  termsVersion: TERMS,
  termsAcceptedAt: NOW,
  countryOfResidence: 'BR',
}

const NEW_USER: SessionUser = {
  ...ONBOARDED,
  isAdult: false,
  termsVersion: null,
  termsAcceptedAt: null,
  countryOfResidence: null,
}

function setup() {
  const users: UserRepository = { completeOnboarding: vi.fn(async () => {}) }
  return {
    users,
    useCases: createUserUseCases({ users, clock: { now: () => NOW }, termsVersion: TERMS }),
  }
}

describe('isOnboarded', () => {
  it('exige 18+, a versão vigente dos Termos e o país', () => {
    expect(isOnboarded(ONBOARDED, TERMS)).toBe(true)
    expect(isOnboarded({ ...ONBOARDED, isAdult: false }, TERMS)).toBe(false)
    expect(isOnboarded(ONBOARDED, '2027-01-01')).toBe(false)
    expect(isOnboarded({ ...ONBOARDED, countryOfResidence: null }, TERMS)).toBe(false)
  })
})

describe('toMe', () => {
  it('expõe o perfil e o estado do onboarding', () => {
    expect(toMe(NEW_USER, TERMS)).toEqual({
      id: ONBOARDED.id,
      name: 'Ana',
      email: 'ana@example.com',
      image: null,
      onboarding: {
        required: true,
        currentTermsVersion: TERMS,
        acceptedTermsVersion: null,
        countryOfResidence: null,
      },
    })
  })
})

describe('createUserUseCases', () => {
  it('requireOnboarded recusa com onboarding_required', () => {
    const { useCases } = setup()
    expect(() => useCases.requireOnboarded(ONBOARDED)).not.toThrow()
    try {
      useCases.requireOnboarded(NEW_USER)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError)
      expect((error as ApplicationError).problem.code).toBe('onboarding_required')
    }
  })

  it('me usa a versão vigente dos Termos', () => {
    const { useCases } = setup()
    expect(useCases.me(ONBOARDED).onboarding.required).toBe(false)
  })

  it('conclui o onboarding com a hora do relógio e devolve o perfil atualizado', async () => {
    const { users, useCases } = setup()
    const me = await useCases.completeOnboarding(NEW_USER, {
      isAdult: true,
      termsVersion: TERMS,
      countryOfResidence: 'PT',
    })
    expect(users.completeOnboarding).toHaveBeenCalledWith(ONBOARDED.id, {
      termsVersion: TERMS,
      countryOfResidence: 'PT',
      acceptedAt: NOW,
    })
    expect(me.onboarding).toEqual({
      required: false,
      currentTermsVersion: TERMS,
      acceptedTermsVersion: TERMS,
      countryOfResidence: 'PT',
    })
  })

  it('recusa termos que não são os vigentes, sem gravar', async () => {
    const { users, useCases } = setup()
    await expect(
      useCases.completeOnboarding(NEW_USER, {
        isAdult: true,
        termsVersion: '2020-01-01',
        countryOfResidence: 'BR',
      }),
    ).rejects.toMatchObject({ problem: { code: 'validation_error' } })
    expect(users.completeOnboarding).not.toHaveBeenCalled()
  })
})
