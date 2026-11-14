import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  snakeCase,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Schema `auth`: tabelas do Better Auth (núcleo, passkey e rate limit em banco), escritas à mão
 * no formato que o adapter do Drizzle espera (o CLI do Better Auth não roda aqui: exigiria `npx`
 * de um pacote fora do lockfile). As propriedades usam os nomes de campo do Better Auth
 * (`emailVerified`, `userId`...), e o `snakeCase.schema` grava as colunas em snake_case. Um teste
 * unitário confere estas tabelas contra o `getAuthTables` do próprio Better Auth.
 *
 * IDs `uuid` (`advanced.database.generateId: 'uuid'`): as FKs `user_id` do schema `app` são uuid.
 * O runtime (`teko_app`) lê e escreve (grants da migração custom).
 */
export const auth = snakeCase.schema('auth')

/**
 * O Better Auth gera os IDs (`generateId: 'uuid'`), exceto no rate limit, que conta com o default
 * do banco: todas as tabelas têm `uuidv7()` como default, como o resto do schema.
 */
const id = () => uuid().primaryKey().default(sql`uuidv7()`)

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}

export const user = auth.table(
  'user',
  {
    id: id(),
    name: text().notNull(),
    email: text().notNull(),
    emailVerified: boolean().notNull().default(false),
    image: text(),
    ...timestamps,
    /** Campos adicionais do onboarding (18+, termos e país de residência). */
    isAdult: boolean().notNull().default(false),
    termsVersion: text(),
    termsAcceptedAt: timestamp({ withTimezone: true }),
    countryOfResidence: text(),
  },
  (t) => [
    uniqueIndex('user_email').on(t.email),
    check(
      'user_country_of_residence',
      sql`${t.countryOfResidence} IS NULL OR ${t.countryOfResidence} ~ '^[A-Z]{2}$'`,
    ),
  ],
)

export const session = auth.table(
  'session',
  {
    id: id(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    token: text().notNull(),
    ...timestamps,
    ipAddress: text(),
    userAgent: text(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('session_token').on(t.token), index('session_user').on(t.userId)],
)

export const account = auth.table(
  'account',
  {
    id: id(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    ...timestamps,
  },
  (t) => [
    index('account_user').on(t.userId),
    uniqueIndex('account_provider_account').on(t.providerId, t.accountId),
  ],
)

export const verification = auth.table(
  'verification',
  {
    id: id(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index('verification_identifier').on(t.identifier)],
)

export const passkey = auth.table(
  'passkey',
  {
    id: id(),
    name: text(),
    publicKey: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    credentialID: text('credential_id').notNull(),
    counter: integer().notNull(),
    deviceType: text().notNull(),
    backedUp: boolean().notNull(),
    transports: text(),
    createdAt: timestamp({ withTimezone: true }),
    aaguid: text(),
  },
  (t) => [index('passkey_user').on(t.userId), uniqueIndex('passkey_credential').on(t.credentialID)],
)

/** Rate limit do Better Auth em banco (`rateLimit.storage: 'database'`): várias instâncias Fluid. */
export const rateLimit = auth.table('rate_limit', {
  id: id(),
  key: text().notNull().unique(),
  count: integer().notNull(),
  lastRequest: bigint({ mode: 'number' }).notNull(),
})

/** Objeto `schema` do adapter (chaves = nomes de modelo do Better Auth). */
export const authSchema = { user, session, account, verification, passkey, rateLimit }
