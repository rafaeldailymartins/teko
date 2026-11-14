import { seedFixtures } from '#adapters/in/cli/seed-fixtures/seed-fixtures.ts'
import type { Container } from '#app/container.ts'
import type { SeedFixtureCorpusResult } from '#app/use-cases/seed-fixture-corpus.ts'
import {
  type ContainerOverrides,
  createContainer,
  createFixtureSeeder,
} from '../../src/composition-root.ts'
import { type Env, parseEnv } from '../../src/config/env.ts'

/**
 * Container da API apontado para um banco de teste, com o fake de embeddings em modo strict sobre
 * a fixture única e o relógio fixo de 2026-11-10 (como todos os testes).
 */

export const FIXTURE_DIR = 'test/fixtures/corpus'
export const FIXTURE_EMBEDDINGS = `${FIXTURE_DIR}/embeddings.json.gz`
export const FIXED_NOW = new Date('2026-11-10T12:00:00-03:00')
const FIXED_CLOCK = { now: () => new Date(FIXED_NOW) }

export function testEnv(databaseUrl: string, appEnv: 'ci' | 'development' = 'ci'): Env {
  return parseEnv({
    APP_ENV: appEnv,
    WEB_ORIGIN: 'http://localhost:3000',
    DATABASE_URL: databaseUrl,
    EMBEDDINGS_PROVIDER: 'fake',
    EMBEDDINGS_FAKE_STRICT: 'true',
    EMBEDDINGS_FIXTURE_PATH: FIXTURE_EMBEDDINGS,
  })
}

export function testContainer(
  databaseUrl: string,
  options: { readonly appEnv?: 'ci' | 'development'; readonly overrides?: ContainerOverrides } = {},
): Container {
  return createContainer(testEnv(databaseUrl, options.appEnv), {
    clock: FIXED_CLOCK,
    applicationName: 'teko-test',
    ...options.overrides,
  })
}

/**
 * Grava a fixture única como owner, pelo mesmo caminho do `cli seed-fixtures` (o
 * `IngestDocumentVersion` da ingestão real).
 */
export async function seedFixtureCorpus(
  ownerUrl: string,
  options: { readonly replace?: boolean } = {},
): Promise<SeedFixtureCorpusResult> {
  const seeder = createFixtureSeeder(testEnv(ownerUrl), ownerUrl, { clock: FIXED_CLOCK })
  try {
    return await seedFixtures(seeder.seedFixtureCorpus, FIXTURE_DIR, {
      replace: options.replace ?? false,
      gitSha: 'test',
      today: '2026-11-10',
    })
  } finally {
    await seeder.close()
  }
}
