import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  DEFAULT_FIXTURE_DIR,
  loadFixtureDocuments,
} from '../../src/adapters/in/cli/seed-fixtures/seed-fixtures.ts'
import { sha256ContentHasher } from '../../src/adapters/out/crypto/sha256-content-hasher.ts'
import {
  BGE_M3_DIMENSIONS,
  BGE_M3_MODEL,
  createWorkersAiEmbeddingAdapter,
} from '../../src/adapters/out/embeddings/workers-ai/workers-ai-embedding-adapter.ts'
import {
  type EmbeddingFixture,
  readEmbeddingFixture,
} from '../../src/adapters/out/fakes/fake-embedding-adapter.ts'
import { encodeHalfVector } from '../../src/adapters/out/fakes/half-float.ts'
import { planEmbeddingBatches } from '../../src/application/services/embedding-batches.ts'
import { chunkText, embeddingText } from '../../src/domain/corpus/chunker.ts'
import { loadGolden } from '../datasets/load-golden.ts'

/**
 * `pnpm --filter @teko/api fixtures:embed`: grava em `test/fixtures/corpus/embeddings.json.gz` os
 * vetores BGE-M3 reais (Workers AI) de todo chunk da fixture e de toda pergunta do golden e de
 * `questions.json` (testes de integração e e2e), indexados
 * pelo `content_hash`. Só chama a API para os hashes que faltam, e tira do arquivo os que não são
 * mais usados. Precisa de `CF_ACCOUNT_ID` e `CF_AI_TOKEN` (escopo Workers AI), que nunca entram no
 * repositório; o custo (neurons) sai no fim.
 *
 * O texto embutido é exatamente o que o `WriteCorpus` embute (`embeddingText(heading_path,
 * content)`) e o que a busca embute (a pergunta): qualquer mudança no chunker, nos títulos ou no
 * golden pede uma nova rodada.
 */

export const FIXTURE_FILE = 'embeddings.json.gz'
/** Perguntas extras dos testes de integração e do e2e (além das do golden). */
export const QUESTIONS_FILE = 'questions.json'

/** Lê o arquivo, ou devolve `undefined` se ele não existe (sem checar antes: evita corrida). */
function readIfExists<T>(read: () => T): T | undefined {
  try {
    return read()
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

function fixtureQuestions(fixtureDir: string): string[] {
  const file = join(fixtureDir, QUESTIONS_FILE)
  const content = readIfExists(() => readFileSync(file, 'utf8'))
  if (content === undefined) {
    return []
  }
  const parsed = JSON.parse(content) as { questions?: unknown }
  if (!Array.isArray(parsed.questions) || !parsed.questions.every((q) => typeof q === 'string')) {
    throw new Error(`${file}: "questions" precisa ser uma lista de textos`)
  }
  return parsed.questions
}

export function fixtureTexts(fixtureDir: string): string[] {
  const texts: string[] = []
  for (const doc of loadFixtureDocuments(fixtureDir)) {
    for (const provision of doc.provisions) {
      for (const version of provision.versions) {
        texts.push(
          ...chunkText(version.text, version.displayLabel).map((piece) =>
            embeddingText(provision.headingPath, piece.content),
          ),
        )
      }
    }
  }
  texts.push(...loadGolden().map((golden) => golden.question), ...fixtureQuestions(fixtureDir))
  return texts
}

export function serializeFixture(fixture: EmbeddingFixture): Buffer {
  const vectors = Object.fromEntries(
    Object.entries(fixture.vectors).sort(([a], [b]) => (a < b ? -1 : 1)),
  )
  // mtime fixo no cabeçalho gzip: o arquivo só muda quando os vetores mudam.
  return gzipSync(`${JSON.stringify({ ...fixture, vectors })}\n`, { level: 9 })
}

async function main(): Promise<void> {
  const accountId = process.env['CF_ACCOUNT_ID']
  const apiToken = process.env['CF_AI_TOKEN']
  const fixtureDir = process.env['FIXTURE_DIR'] ?? DEFAULT_FIXTURE_DIR
  const target = join(fixtureDir, FIXTURE_FILE)
  const existing: EmbeddingFixture = readIfExists(() => readEmbeddingFixture(target)) ?? {
    model: BGE_M3_MODEL,
    dimensions: BGE_M3_DIMENSIONS,
    vectors: {},
  }

  const byHash = new Map<string, string>()
  for (const text of fixtureTexts(fixtureDir)) {
    byHash.set(sha256ContentHasher.hash(text), text)
  }
  const missing = [...byHash.entries()].filter(([hash]) => existing.vectors[hash] === undefined)
  const vectors: Record<string, string> = {}
  for (const hash of byHash.keys()) {
    const known = existing.vectors[hash]
    if (known !== undefined) {
      vectors[hash] = known
    }
  }
  let neurons = 0
  if (missing.length > 0) {
    if (accountId === undefined || apiToken === undefined) {
      throw new Error(
        `${String(missing.length)} textos sem vetor; defina CF_ACCOUNT_ID e CF_AI_TOKEN`,
      )
    }
    const embeddings = createWorkersAiEmbeddingAdapter({
      accountId,
      apiToken,
      onUsage: (usage) => {
        neurons += usage.neurons ?? 0
      },
    })
    let done = 0
    for (const indexes of planEmbeddingBatches(missing.map(([, text]) => text))) {
      const batch = indexes.flatMap((index) => {
        const entry = missing[index]
        return entry === undefined ? [] : [entry]
      })
      const result = await embeddings.embed(batch.map(([, text]) => text))
      for (const [index, [hash]] of batch.entries()) {
        const vector = result[index]
        if (vector === undefined) {
          throw new Error(`Workers AI não devolveu o vetor ${String(index)} do lote`)
        }
        vectors[hash] = encodeHalfVector(vector)
      }
      done += batch.length
      console.log(`${String(done)}/${String(missing.length)}`)
    }
  }
  const removed = Object.keys(existing.vectors).filter((hash) => !byHash.has(hash)).length
  writeFileSync(
    target,
    serializeFixture({ model: BGE_M3_MODEL, dimensions: BGE_M3_DIMENSIONS, vectors }),
  )
  console.log(
    `${target}: ${String(byHash.size)} vetores (${String(missing.length)} novos, ${String(removed)} removidos); ` +
      `custo real: ${neurons.toFixed(2)} neurons`,
  )
}

if (import.meta.main) {
  await main()
}
