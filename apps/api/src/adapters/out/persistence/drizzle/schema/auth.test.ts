import { passkey } from '@better-auth/passkey'
import { getAuthTables } from 'better-auth/db'
import { getTableColumns } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { authSchema } from './auth.ts'

/**
 * O schema `auth` é escrito à mão (sem o CLI do Better Auth). Este teste confere cada modelo e
 * cada campo que o Better Auth espera (núcleo, passkey, rate limit em banco e os campos adicionais
 * do onboarding) contra as colunas do Drizzle, inclusive a obrigatoriedade.
 */
const expected = getAuthTables({
  plugins: [passkey({ rpID: 'tekoia.vercel.app', rpName: 'Tekó' })],
  rateLimit: { enabled: true, storage: 'database' },
  user: {
    additionalFields: {
      isAdult: { type: 'boolean', required: false, defaultValue: false, input: false },
      termsVersion: { type: 'string', required: false, input: false },
      termsAcceptedAt: { type: 'date', required: false, input: false },
      countryOfResidence: { type: 'string', required: false, input: false },
    },
  },
})

describe('schema auth', () => {
  it('tem um modelo para cada tabela do Better Auth', () => {
    expect(Object.keys(authSchema).sort()).toEqual(Object.keys(expected).sort())
  })

  it.each(Object.entries(expected))(
    '%s: todos os campos, com a obrigatoriedade',
    (model, table) => {
      const columns: Record<string, { notNull: boolean }> = getTableColumns(
        authSchema[model as keyof typeof authSchema],
      )
      expect(columns['id']).toBeDefined()
      for (const [field, attributes] of Object.entries(table.fields)) {
        const column = columns[field]
        expect(column, `${model}.${field}`).toBeDefined()
        if (attributes.required === true) {
          expect(column?.notNull, `${model}.${field} NOT NULL`).toBe(true)
        }
      }
    },
  )
})
