import { eq } from 'drizzle-orm'
import type { UserRepository } from '#app/ports/user-repository.ts'
import type { DrizzleDb } from '../client.ts'
import { user } from '../schema/auth.ts'

/**
 * Onboarding em `auth.user` (`teko_app`). O `cookieCache` do Better Auth guarda o usuário por até
 * 5 min: a rota de onboarding devolve o perfil já atualizado, e as rotas que conferem o
 * onboarding leem a sessão do banco quando o cache ainda diz "pendente".
 */
export function createPgUserRepository(db: DrizzleDb): UserRepository {
  return {
    async completeOnboarding(userId, record) {
      await db
        .update(user)
        .set({
          isAdult: true,
          termsVersion: record.termsVersion,
          termsAcceptedAt: record.acceptedAt,
          countryOfResidence: record.countryOfResidence,
          updatedAt: record.acceptedAt,
        })
        .where(eq(user.id, userId))
    },
  }
}
