import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit: `generate` em dev (gera SQL a partir do schema) e `migrate` no deploy, na URL
 * DIRETA do owner (`NEON_*_MIGRATE_URL`, nunca a do pooler), antes do `vercel deploy --prebuilt`.
 * Sempre expand/contract: o `migration-guard` do CI barra DROP e RENAME sem o label `contract`.
 *
 * Extensões, `immutable_unaccent`, o EXCLUDE de `pv_no_overlap` e os grants ficam
 * em migrações custom (`drizzle-kit generate --custom`), porque o Drizzle não os expressa.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/adapters/out/persistence/drizzle/schema/index.ts',
  out: './drizzle/migrations',
  schemaFilter: ['corpus', 'app', 'auth'],
  dbCredentials: {
    // Só `migrate` e `push` leem a URL; `generate` funciona sem ela.
    url: process.env['DATABASE_MIGRATE_URL'] ?? '',
  },
  verbose: true,
})
