/** Escrita dos campos da aplicação no usuário do Better Auth (`auth.user`). */
interface OnboardingRecord {
  readonly termsVersion: string
  readonly countryOfResidence: string
  readonly acceptedAt: Date
}

export interface UserRepository {
  completeOnboarding(userId: string, record: OnboardingRecord): Promise<void>
}
