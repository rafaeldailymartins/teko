import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * A fronteira "apps/web é só frontend" vive no `apps/web/biome.json` aninhado: com `extends: "//"`,
 * os `includes` dos overrides resolvem a partir do diretório do config aninhado, então um override
 * `apps/web/**` no config raiz nunca casa com arquivos daqui (e o lint passava calado).
 *
 * O teste roda o Biome do repositório numa cópia isolada dos dois configs (vcs desligado, sem
 * tocar na árvore real) com arquivos-sonda que precisam ser barrados.
 */

const WEB_DIR = fileURLToPath(new URL('..', import.meta.url))
const REPO_ROOT = join(WEB_DIR, '..', '..')
const BIOME_BIN = createRequire(join(REPO_ROOT, 'package.json')).resolve('@biomejs/biome/bin/biome')

const PROBES = {
  'src/lib/server-probe.ts': [
    "import { NextResponse } from 'next/server'",
    "import { drizzle } from 'drizzle-orm/node-postgres'",
    "import { Pool } from 'pg'",
    "import { betterAuth } from 'better-auth'",
    '',
    'export const probes = [NextResponse, drizzle, Pool, betterAuth]',
    '',
  ].join('\n'),
  'src/components/img-probe.tsx': [
    'export function ImgProbe() {',
    '  return <img src="/probe.png" alt="sonda" />',
    '}',
    '',
  ].join('\n'),
} as const

interface BiomeDiagnostic {
  readonly category?: string
  readonly location?: { readonly path?: string | { readonly file?: string } }
}

function diagnosticPath(diagnostic: BiomeDiagnostic): string {
  const path = diagnostic.location?.path
  return (typeof path === 'string' ? path : (path?.file ?? '')).replaceAll('\\', '/')
}

function readConfig(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

function writeConfig(path: string, config: Record<string, unknown>): void {
  writeFileSync(path, JSON.stringify({ ...config, $schema: undefined }))
}

let sandbox: string
let diagnostics: readonly BiomeDiagnostic[]

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'teko-biome-web-'))
  // `$schema` sai (o caminho relativo não existe na cópia); o vcs sai porque não há `.git` nela.
  const rootConfig = readConfig(join(REPO_ROOT, 'biome.json'))
  writeConfig(join(sandbox, 'biome.json'), { ...rootConfig, vcs: { enabled: false } })

  const webSandbox = join(sandbox, 'apps', 'web')
  mkdirSync(webSandbox, { recursive: true })
  writeConfig(join(webSandbox, 'biome.json'), readConfig(join(WEB_DIR, 'biome.json')))

  for (const [relativePath, source] of Object.entries(PROBES)) {
    const target = join(webSandbox, relativePath)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, source)
  }

  const result = spawnSync(
    process.execPath,
    [BIOME_BIN, 'lint', '--reporter=json', '--max-diagnostics=none', 'apps/web'],
    { cwd: sandbox, encoding: 'utf8' },
  )
  const report = JSON.parse(result.stdout) as { diagnostics: BiomeDiagnostic[] }
  diagnostics = report.diagnostics
}, 60_000)

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

describe('apps/web/biome.json', () => {
  it('barra imports de servidor, banco e auth (um diagnóstico por import)', () => {
    const restricted = diagnostics.filter(
      (diagnostic) =>
        diagnostic.category === 'lint/style/noRestrictedImports' &&
        diagnosticPath(diagnostic).endsWith('server-probe.ts'),
    )
    expect(restricted).toHaveLength(4)
  })

  it('liga os domínios react e next (noImgElement do domínio next)', () => {
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.category === 'lint/performance/noImgElement' &&
          diagnosticPath(diagnostic).endsWith('img-probe.tsx'),
      ),
    ).toBe(true)
  })
})
