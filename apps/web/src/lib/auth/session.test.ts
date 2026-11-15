import { ErrorCode } from '@teko/shared/errors'
import { describe, expect, it } from 'vitest'
import {
  initialsOf,
  isComposerBlocked,
  OnboardingKind,
  onboardingKind,
  SessionStatus,
  sessionStatus,
} from './session.ts'

function onboarding(
  overrides: Partial<{
    required: boolean
    currentTermsVersion: string
    acceptedTermsVersion: string | null
    countryOfResidence: string | null
  }> = {},
) {
  return {
    onboarding: {
      required: false,
      currentTermsVersion: '2026-11-14',
      acceptedTermsVersion: '2026-11-14',
      countryOfResidence: 'BR',
      ...overrides,
    },
  }
}

describe('sessionStatus', () => {
  it('carregando enquanto não há dado nem erro', () => {
    expect(sessionStatus({ data: undefined, error: null })).toBe(SessionStatus.Loading)
  })

  it('401 é ausência de sessão; outro erro é indisponível', () => {
    expect(sessionStatus({ data: undefined, error: { code: ErrorCode.Unauthenticated } })).toBe(
      SessionStatus.Anonymous,
    )
    expect(sessionStatus({ data: undefined, error: { code: ErrorCode.Internal } })).toBe(
      SessionStatus.Unavailable,
    )
  })

  it('com sessão, o onboarding decide entre pronto e pendente', () => {
    expect(sessionStatus({ data: onboarding(), error: null })).toBe(SessionStatus.Ready)
    expect(sessionStatus({ data: onboarding({ required: true }), error: null })).toBe(
      SessionStatus.Onboarding,
    )
  })

  it('um dado em cache vale mais que o erro de uma releitura', () => {
    expect(sessionStatus({ data: onboarding(), error: { code: ErrorCode.Internal } })).toBe(
      SessionStatus.Ready,
    )
  })
})

describe('isComposerBlocked', () => {
  it('só libera com sessão e onboarding concluído', () => {
    expect(isComposerBlocked(SessionStatus.Ready)).toBe(false)
    for (const status of [
      SessionStatus.Loading,
      SessionStatus.Anonymous,
      SessionStatus.Onboarding,
      SessionStatus.Unavailable,
    ]) {
      expect(isComposerBlocked(status), status).toBe(true)
    }
  })
})

describe('onboardingKind', () => {
  it('primeiro uso quando nunca aceitou os Termos', () => {
    expect(onboardingKind(onboarding({ required: true, acceptedTermsVersion: null }))).toBe(
      OnboardingKind.First,
    )
  })

  it('novo aceite quando a versão vigente mudou', () => {
    expect(onboardingKind(onboarding({ required: true, acceptedTermsVersion: '2026-01-01' }))).toBe(
      OnboardingKind.TermsUpdate,
    )
  })

  it('a mesma versão aceita (falta só outro campo) é o primeiro uso', () => {
    expect(onboardingKind(onboarding({ required: true }))).toBe(OnboardingKind.First)
  })
})

describe('initialsOf', () => {
  it.each([
    ['Ana Maria Souza', 'AS'],
    ['ana', 'A'],
    ['  élio  ', 'É'],
    ['', '?'],
    ['   ', '?'],
  ])('%j vira %s', (name, expected) => {
    expect(initialsOf(name)).toBe(expected)
  })
})
