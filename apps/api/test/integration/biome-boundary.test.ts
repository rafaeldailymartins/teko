import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { removeTempDir } from '../setup/temp-dir.ts'

/**
 * Regressão da fronteira hexagonal no Biome (override de `src/domain/**` e `src/application/**`
 * no `biome.json` raiz): domínio e aplicação não importam frameworks, SDKs nem adapters — inclusive
 * por caminhos aninhados (`#adapters/out/...`, `drizzle-orm/pg-core`), que padrões de um segmento só
 * deixavam passar. O dependency-cruiser cobre o grafo resolvido; este teste cobre o lint.
 *
 * Roda o Biome do repositório numa cópia isolada do config raiz (vcs desligado), sem tocar na árvore.
 */

const API_DIR = fileURLToPath(new URL('../..', import.meta.url))
const REPO_ROOT = join(API_DIR, '..', '..')
const BIOME_BIN = createRequire(join(REPO_ROOT, 'package.json')).resolve('@biomejs/biome/bin/biome')

const FORBIDDEN_IMPORTS = [
  "import fastify from 'fastify'",
  "import cors from '@fastify/cors'",
  "import { pgTable } from 'drizzle-orm/pg-core'",
  "import { Pool } from 'pg'",
  "import { GoogleGenAI } from '@google/genai'",
  "import Groq from 'groq-sdk'",
  "import { admin } from 'better-auth/plugins'",
  "import { waitUntil } from '@vercel/functions'",
  "import { GeminiAdapter } from '#adapters/out/llm/gemini/gemini-adapter.ts'",
] as const

function probe(imports: readonly string[]): string {
  return `${imports.join('\n')}\n\nexport const probes = [${imports.length}]\n`
}

const PROBES = {
  'apps/api/src/domain/vigencia/probe.ts': probe(FORBIDDEN_IMPORTS),
  'apps/api/src/application/use-cases/probe.ts': probe(FORBIDDEN_IMPORTS),
  // Controle: adapters podem importar frameworks.
  'apps/api/src/adapters/in/http/probe.ts': probe(["import fastify from 'fastify'"]),
} as const

interface BiomeDiagnostic {
  readonly category?: string
  readonly location?: { readonly path?: string | { readonly file?: string } }
}

function diagnosticPath(diagnostic: BiomeDiagnostic): string {
  const path = diagnostic.location?.path
  return (typeof path === 'string' ? path : (path?.file ?? '')).replaceAll('\\', '/')
}

function restrictedIn(suffix: string): number {
  return diagnostics.filter(
    (diagnostic) =>
      diagnostic.category === 'lint/style/noRestrictedImports' &&
      diagnosticPath(diagnostic).endsWith(suffix),
  ).length
}

let sandbox: string
let diagnostics: readonly BiomeDiagnostic[]

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'teko-biome-api-'))
  const rootConfig = JSON.parse(readFileSync(join(REPO_ROOT, 'biome.json'), 'utf8')) as Record<
    string,
    unknown
  >
  // `$schema` sai (o caminho relativo não existe na cópia); o vcs sai porque não há `.git` nela.
  writeFileSync(
    join(sandbox, 'biome.json'),
    JSON.stringify({ ...rootConfig, $schema: undefined, vcs: { enabled: false } }),
  )
  for (const [relativePath, source] of Object.entries(PROBES)) {
    const target = join(sandbox, relativePath)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, source)
  }
  const result = spawnSync(
    process.execPath,
    [BIOME_BIN, 'lint', '--reporter=json', '--max-diagnostics=none', 'apps/api'],
    { cwd: sandbox, encoding: 'utf8' },
  )
  diagnostics = (JSON.parse(result.stdout) as { diagnostics: BiomeDiagnostic[] }).diagnostics
}, 60_000)

afterAll(() => {
  removeTempDir(sandbox)
})

describe('biome.json: fronteira hexagonal de src/domain e src/application', () => {
  it('barra todo import proibido no domínio, inclusive caminhos aninhados', () => {
    expect(restrictedIn('src/domain/vigencia/probe.ts')).toBe(FORBIDDEN_IMPORTS.length)
  })

  it('barra todo import proibido na aplicação, inclusive caminhos aninhados', () => {
    expect(restrictedIn('src/application/use-cases/probe.ts')).toBe(FORBIDDEN_IMPORTS.length)
  })

  it('não barra frameworks nos adapters', () => {
    expect(restrictedIn('src/adapters/in/http/probe.ts')).toBe(0)
  })
})
