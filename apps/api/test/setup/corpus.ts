import { seedFixtures } from '#adapters/in/cli/seed-fixtures/seed-fixtures.ts'
import type { Container } from '#app/container.ts'
import type { CorpusWriteResult } from '#app/ports/corpus-writer.ts'
import { type ContainerOverrides, createContainer } from '../../src/composition-root.ts'
import { parseEnv } from '../../src/config/env.ts'

/**
 * Container da API apontado para um banco de teste, com o fake de embeddings em modo strict sobre
 * a fixture única e o relógio fixo de 2026-11-10 (como todos os testes).
 */

export const FIXTURE_DIR = 'test/fixtures/corpus'
export const FIXTURE_EMBEDDINGS = `${FIXTURE_DIR}/embeddings.json.gz`
export const FIXED_NOW = new Date('2026-11-10T12:00:00-03:00')

export function testContainer(
  databaseUrl: string,
  options: { readonly appEnv?: 'ci' | 'development'; readonly overrides?: ContainerOverrides } = {},
): Container {
  const env = parseEnv({
    APP_ENV: options.appEnv ?? 'ci',
    WEB_ORIGIN: 'http://localhost:3000',
    DATABASE_URL: databaseUrl,
    EMBEDDINGS_PROVIDER: 'fake',
    EMBEDDINGS_FAKE_STRICT: 'true',
    EMBEDDINGS_FIXTURE_PATH: FIXTURE_EMBEDDINGS,
  })
  return createContainer(env, {
    clock: { now: () => new Date(FIXED_NOW) },
    applicationName: 'teko-test',
    ...options.overrides,
  })
}

/** Grava a fixture única como owner (o mesmo caminho do `cli seed-fixtures`). */
export async function seedFixtureCorpus(ownerUrl: string): Promise<CorpusWriteResult> {
  const container = testContainer(ownerUrl)
  try {
    const writeCorpus = container.useCases.writeCorpus
    if (writeCorpus === null) {
      throw new Error('container sem writeCorpus')
    }
    return await seedFixtures(writeCorpus, FIXTURE_DIR, { replace: false })
  } finally {
    await container.close()
  }
}
