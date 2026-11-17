/**
 * Instala o binário do posthog-cli em `tools/posthog-cli/bin/`, conferindo o sha256 do arquivo
 * baixado (ADR 0037).
 *
 * O pacote `@posthog/cli` do npm é só um instalador do cargo-dist: o `postinstall` dele baixa o
 * binário de `releases.posthog.com` sem conferir nada, e por isso fica desligado
 * (`allowBuilds: false` em `pnpm-workspace.yaml`). O pacote continua aqui para fixar a versão no
 * lockfile, passar pela política do pnpm (proveniência, 7 dias) e receber o Dependabot; este script
 * baixa o mesmo artefato do GitHub Releases do PostHog e só o extrai se o sha256 bater com o
 * fixado abaixo (o `digest` que o GitHub publica para o asset).
 *
 * Ao subir a versão do `@posthog/cli`, atualize `PINNED` com os digests novos:
 *
 *   gh api repos/PostHog/posthog/releases/tags/posthog-cli/v<versão> \
 *     --jq '.assets[] | select(.name | test("x86_64-(unknown-linux-gnu|pc-windows-msvc)\\.(tar\\.gz|zip)$")) | [.name, .digest] | @tsv'
 *
 * Uso: `pnpm --dir tools/posthog-cli install --frozen-lockfile && node tools/posthog-cli/install-binary.mjs`.
 * Idempotente (não baixa de novo se o binário da mesma versão já está lá). Sem dependências.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const TOOL_DIR = import.meta.dirname
export const BIN_DIR = join(TOOL_DIR, 'bin')
const MARKER = join(BIN_DIR, '.installed')

/** Versão do `package.json` (a mesma do lockfile) e o artefato de cada plataforma suportada. */
const PINNED = {
  version: '0.19.0',
  artifacts: {
    'linux-x64': {
      name: 'posthog-cli-x86_64-unknown-linux-gnu.tar.gz',
      sha256: '6d753ad8eafef0c2a4cf3d64d59dca7ad8236688a812f58c4496cc482016d6b3',
    },
    'win32-x64': {
      name: 'posthog-cli-x86_64-pc-windows-msvc.zip',
      sha256: '0570725c3df10342b5623a80d84a4e9c6c0a3682a4612656a5f007462ec4477d',
    },
  },
}

/** Caminho do binário instalado nesta plataforma. */
export function binaryPath() {
  return join(BIN_DIR, process.platform === 'win32' ? 'posthog-cli.exe' : 'posthog-cli')
}

function installedVersion() {
  const manifest = join(TOOL_DIR, 'node_modules', '@posthog', 'cli', 'package.json')
  if (!existsSync(manifest)) {
    throw new Error(
      'tools/posthog-cli sem node_modules: rode `pnpm --dir tools/posthog-cli install --frozen-lockfile`',
    )
  }
  return JSON.parse(readFileSync(manifest, 'utf8')).version
}

function extract(archive, name) {
  if (name.endsWith('.zip')) {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath $env:ARCHIVE -DestinationPath $env:DEST -Force",
      ],
      { env: { ...process.env, ARCHIVE: archive, DEST: BIN_DIR }, stdio: 'inherit' },
    )
    return
  }
  // O tar.gz do cargo-dist traz um diretório no topo.
  execFileSync('tar', ['-xzf', archive, '--strip-components', '1', '-C', BIN_DIR], {
    stdio: 'inherit',
  })
}

async function main() {
  const version = installedVersion()
  if (version !== PINNED.version) {
    throw new Error(
      `@posthog/cli ${version} instalado, mas os sha256 fixados são da ${PINNED.version}: atualize PINNED em install-binary.mjs`,
    )
  }
  const artifact = PINNED.artifacts[`${process.platform}-${process.arch}`]
  if (artifact === undefined) {
    throw new Error(`sem artefato fixado para ${process.platform}-${process.arch}`)
  }
  const stamp = `${version} ${artifact.sha256}`
  if (existsSync(binaryPath()) && existsSync(MARKER) && readFileSync(MARKER, 'utf8') === stamp) {
    process.stdout.write(`posthog-cli ${version} já instalado em ${binaryPath()}\n`)
    return
  }
  const url = `https://github.com/PostHog/posthog/releases/download/posthog-cli/v${version}/${artifact.name}`
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`download de ${url} respondeu ${response.status}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== artifact.sha256) {
    throw new Error(`sha256 de ${artifact.name} é ${digest}, esperado ${artifact.sha256}`)
  }
  const scratch = mkdtempSync(join(tmpdir(), 'posthog-cli-'))
  try {
    const archive = join(scratch, artifact.name)
    writeFileSync(archive, bytes)
    rmSync(BIN_DIR, { recursive: true, force: true })
    mkdirSync(BIN_DIR, { recursive: true })
    extract(archive, artifact.name)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  if (!existsSync(binaryPath())) {
    throw new Error(`${artifact.name} extraído, mas ${binaryPath()} não existe`)
  }
  writeFileSync(MARKER, stamp)
  process.stdout.write(`posthog-cli ${version} instalado em ${binaryPath()} (sha256 conferido)\n`)
}

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    console.error(`install-binary: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
