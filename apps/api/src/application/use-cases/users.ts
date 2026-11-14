import type { MeResponse, OnboardingRequest } from '@teko/shared/contracts'
import { ErrorCode } from '@teko/shared/errors'
import { ApplicationError } from '../errors.ts'
import type { SessionUser } from '../ports/auth-gateway.ts'
import type { Clock } from '../ports/clock.ts'
import type { UserRepository } from '../ports/user-repository.ts'

/**
 * Perfil e onboarding (`GET /api/v1/me`, `POST /api/v1/me/onboarding`). O onboarding vale para a
 * versão vigente dos Termos: quando ela muda, o usuário aceita de novo antes de perguntar.
 */

/** Onboarding concluído na versão vigente dos Termos. */
export function isOnboarded(user: SessionUser, currentTermsVersion: string): boolean {
  return (
    user.isAdult && user.termsVersion === currentTermsVersion && user.countryOfResidence !== null
  )
}

export function toMe(user: SessionUser, currentTermsVersion: string): MeResponse {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    onboarding: {
      required: !isOnboarded(user, currentTermsVersion),
      currentTermsVersion,
      acceptedTermsVersion: user.termsVersion,
      countryOfResidence: user.countryOfResidence,
    },
  }
}

export interface UserUseCases {
  /** Recusa com `onboarding_required` se o usuário não concluiu o onboarding. */
  requireOnboarded(user: SessionUser): void
  me(user: SessionUser): MeResponse
  completeOnboarding(user: SessionUser, request: OnboardingRequest): Promise<MeResponse>
}

export function createUserUseCases(deps: {
  readonly users: UserRepository
  readonly clock: Clock
  readonly termsVersion: string
}): UserUseCases {
  return {
    requireOnboarded(user) {
      if (!isOnboarded(user, deps.termsVersion)) {
        throw new ApplicationError({ code: ErrorCode.OnboardingRequired })
      }
    },
    me: (user) => toMe(user, deps.termsVersion),
    async completeOnboarding(user, request) {
      if (request.termsVersion !== deps.termsVersion) {
        throw new ApplicationError({
          code: ErrorCode.ValidationError,
          detail: 'Accepted terms version is not the current one',
          errors: [{ path: 'termsVersion', message: `expected ${deps.termsVersion}` }],
        })
      }
      const acceptedAt = deps.clock.now()
      await deps.users.completeOnboarding(user.id, {
        termsVersion: request.termsVersion,
        countryOfResidence: request.countryOfResidence,
        acceptedAt,
      })
      return toMe(
        {
          ...user,
          isAdult: true,
          termsVersion: request.termsVersion,
          termsAcceptedAt: acceptedAt,
          countryOfResidence: request.countryOfResidence,
        },
        deps.termsVersion,
      )
    },
  }
}
