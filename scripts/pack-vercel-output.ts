/**
 * Empacota o `.vercel/output` (Build Output API gerado por `vercel build`) num tarball
 * determinístico, verificado e com sha256, para atestar no CI e depois implantar com
 * `vercel deploy --prebuilt` (Deploy e rollback, passo 4 do plano; também usado no spike F1 (b)).
 *
 * O repositório é público e o tarball vira artifact (staging) ou asset do release (produção), que
 * qualquer um baixa. Por isso, antes de empacotar:
 *
 * - só `output/` entra: `.vercel/.env*` (gerados pelo `vercel pull`) e `.vercel/project.json` ficam
 *   fora por construção, e qualquer `.env*` ou `project.json` DENTRO do output derruba o script;
 * - link simbólico que aponta para fora do output derruba o script;
 * - nenhum arquivo pode trazer uma env var conhecida já com valor (linha `NOME=` de dotenv ou chave
 *   JSON `"NOME": "..."`), para os nomes de Config e de Sensitive de `infra/vercel/env.<env>.json`;
 * - o gitleaks (`gitleaks dir`) varre o conteúdo e precisa terminar limpo.
 *
 * O tar é determinístico: GNU tar com `--sort=name`, `--mtime` fixo (`SOURCE_DATE_EPOCH`, ou 0),
 * dono 0:0 numérico e cabeçalhos pax sem atime/ctime; o gzip do Node não grava nome nem data. Os
 * caminhos dentro do tar começam em `output/`, para extrair com `tar -xzf <arquivo> -C .vercel`.
 *
 * Uso (no runner Ubuntu do Actions, depois do `vercel build`):
 *   node scripts/pack-vercel-output.ts --env production|staging
 *
 * `--env` é o ÚNICO argumento, validado contra um conjunto constante; nenhum valor da linha de
 * comando vira caminho nem argumento de processo. Tudo sai de constantes resolvidas a partir do
 * próprio script (raiz do repositório) e do ambiente escolhido:
 *
 * - env vars conhecidas: `infra/vercel/env.<env>.json`;
 * - build: o primeiro de `.vercel/output` e `apps/api/.vercel/output` que existir (com Root
 *   Directory `apps/api`, o `vercel build` grava no segundo);
 * - saída: `dist/vercel/<env>/output.tgz` e `dist/vercel/<env>/output.tgz.sha256` (formato do
 *   `sha256sum`) e, com `GITHUB_OUTPUT`, as saídas `tarball`, `sha256` e `bytes`.
 *
 * `gitleaks` e `tar` são procurados só em diretórios absolutos e protegidos do PATH
 * (`findOnSafePath`); no CI, o gitleaks verificado por SHA-256 vai para um diretório acrescentado ao
 * `GITHUB_PATH`. `SOURCE_DATE_EPOCH`, se definida, precisa ser só dígitos. Argumento desconhecido,
 * a mais ou `--env` fora do conjunto terminam com código 2; falha de empacotamento, com 1. Não usa
 * dependências: só o Node 24 (type stripping).
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import process, { env } from 'node:process'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'
import { compareCodeUnits, findOnSafePath, resolveInsideRoot } from './lib/cli-guards.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..')
/** Onde o `vercel build` grava o `.vercel/` (raiz do repositório ou Root Directory `apps/api`). */
const VERCEL_DIR_CANDIDATES = [
  join(REPO_ROOT, '.vercel'),
  join(REPO_ROOT, 'apps', 'api', '.vercel'),
]
/** Nomes que nunca podem estar no output (dotenv do `vercel pull` e o link do projeto). */
const FORBIDDEN_NAME = /^(?:\.env(?:\..*)?|project\.json)$/
/**
 * Nomes genéricos demais para a busca (dependências trazem `"NODE_ENV": "production"` e afins);
 * nenhum deles é segredo.
 */
const GENERIC_ENV_NAMES: ReadonlySet<string> = new Set(['NODE_ENV', 'LOG_LEVEL'])
/** Tamanho máximo de arquivo varrido em busca de env vars (bundles maiores são raros). */
const MAX_SCAN_BYTES = 32 * 1024 * 1024

/** Ambiente de deploy: tudo o que o script lê e escreve é derivado dele e da raiz. */
interface Target {
  readonly name: 'production' | 'staging'
  readonly envFile: string
  readonly out: string
}

function target(name: Target['name']): Target {
  return {
    name,
    envFile: join(REPO_ROOT, 'infra', 'vercel', `env.${name}.json`),
    out: join(REPO_ROOT, 'dist', 'vercel', name, 'output.tgz'),
  }
}

/** Conjunto constante dos valores aceitos em `--env`. */
const TARGETS: ReadonlyMap<string, Target> = new Map(
  (['production', 'staging'] as const).map((name) => [name, target(name)]),
)

const USAGE = `uso: node scripts/pack-vercel-output.ts --env ${[...TARGETS.keys()].join('|')}`

class PackError extends Error {}
class UsageError extends Error {}

function parseTarget(): Target {
  let value: string | undefined
  try {
    value = parseArgs({
      options: { env: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    }).values.env
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error))
  }
  // O valor da linha de comando só serve de chave: o que segue adiante é a constante do conjunto.
  const selected = value === undefined ? undefined : TARGETS.get(value)
  if (selected === undefined) {
    throw new UsageError(
      value === undefined ? '--env é obrigatório' : `--env ${JSON.stringify(value)} desconhecido`,
    )
  }
  return selected
}

/** Primeiro `.vercel/` candidato com `output/`; os candidatos são constantes. */
function findVercelDir(): string {
  const found = VERCEL_DIR_CANDIDATES.find((dir) => existsSync(join(dir, 'output')))
  if (found === undefined) {
    const names = VERCEL_DIR_CANDIDATES.map((dir) => relative(REPO_ROOT, join(dir, 'output')))
    throw new PackError(`nenhum ${names.join(' nem ')}; rode \`vercel build\` antes`)
  }
  // Defesa em profundidade: um link simbólico no lugar do `.vercel/` não sai do repositório.
  return resolveInsideRoot(REPO_ROOT, found, REPO_ROOT)
}

interface Entry {
  readonly path: string
  readonly relativePath: string
  readonly kind: 'file' | 'dir' | 'symlink'
}

function walk(root: string, current = root, entries: Entry[] = []): Entry[] {
  for (const name of readdirSync(current).sort(compareCodeUnits)) {
    const path = join(current, name)
    const relativePath = relative(root, path).split(sep).join('/')
    const stat = lstatSync(path)
    if (FORBIDDEN_NAME.test(name)) {
      throw new PackError(`arquivo proibido no output: ${relativePath}`)
    }
    if (stat.isSymbolicLink()) {
      entries.push({ path, relativePath, kind: 'symlink' })
    } else if (stat.isDirectory()) {
      entries.push({ path, relativePath, kind: 'dir' })
      walk(root, path, entries)
    } else if (stat.isFile()) {
      entries.push({ path, relativePath, kind: 'file' })
    } else {
      throw new PackError(`tipo de arquivo não suportado no output: ${relativePath}`)
    }
  }
  return entries
}

function assertSymlinksInside(root: string, entries: readonly Entry[]): void {
  for (const entry of entries.filter((e) => e.kind === 'symlink')) {
    const target = readlinkSync(entry.path)
    const resolved = isAbsolute(target) ? target : resolve(dirname(entry.path), target)
    const fromRoot = relative(root, resolved)
    if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
      throw new PackError(`link simbólico aponta para fora do output: ${entry.relativePath}`)
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Nomes de env vars de `infra/vercel/env.*.json` (Config e Sensitive). */
function knownEnvNames(envFiles: readonly string[]): string[] {
  const names = new Set<string>()
  for (const file of envFiles) {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    for (const section of ['config', 'sensitive']) {
      const block: unknown =
        typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, section) : undefined
      if (typeof block === 'object' && block !== null) {
        for (const name of Object.keys(block)) {
          if (!GENERIC_ENV_NAMES.has(name)) {
            names.add(name)
          }
        }
      }
    }
  }
  if (names.size === 0) {
    throw new PackError(`nenhuma env var conhecida em ${envFiles.join(', ')}`)
  }
  return [...names].sort(compareCodeUnits)
}

/**
 * Uma env var "com valor" no output: linha de dotenv (`NOME=valor`) ou chave JSON com string não
 * vazia (`"NOME": "valor"`). O código-fonte compilado cita os nomes (`env.WEB_ORIGIN`,
 * `issue('NODE_ENV', ...)`) sem casar com nenhum dos dois formatos.
 */
function envAssignmentPattern(names: readonly string[]): RegExp {
  const alternatives = names.map(escapeRegExp).join('|')
  return new RegExp(
    `(?:^|\\n)\\s*(?:export\\s+)?(?:${alternatives})=\\S|"(?:${alternatives})"\\s*:\\s*"[^"]`,
  )
}

function assertNoEnvAssignments(entries: readonly Entry[], pattern: RegExp): void {
  const offenders = entries
    .filter((e) => e.kind === 'file' && lstatSync(e.path).size <= MAX_SCAN_BYTES)
    .filter((e) => pattern.test(readFileSync(e.path, 'latin1')))
    .map((e) => e.relativePath)
  if (offenders.length > 0) {
    throw new PackError(`env var com valor dentro do output: ${offenders.join(', ')}`)
  }
}

/**
 * `executable` é sempre o caminho absoluto devolvido por `findOnSafePath` para um nome constante
 * (`tar`, `gitleaks`); o spawn é sem shell, e os argumentos (array) saem só de constantes e de
 * caminhos derivados da raiz do repositório.
 */
function run(executable: string, args: readonly string[]): Buffer {
  const command = basename(executable)
  const result = spawnSync(executable, args, { shell: false, maxBuffer: 1024 * 1024 * 1024 })
  if (result.error !== undefined) {
    throw new PackError(`não foi possível executar ${command}: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const stderr = result.stderr.toString('utf8').trim()
    throw new PackError(`${command} terminou com código ${String(result.status)}: ${stderr}`)
  }
  return result.stdout
}

function runGitleaks(outputDir: string): void {
  // --redact: o log do Actions nunca mostra o valor encontrado.
  run(findOnSafePath('gitleaks'), ['dir', outputDir, '--no-banner', '--redact', '--exit-code', '1'])
}

/** `SOURCE_DATE_EPOCH` (segundos), só dígitos; ausente ou vazia vale 0. */
function sourceDateEpoch(): number {
  const raw = env['SOURCE_DATE_EPOCH']
  if (raw === undefined || raw === '') {
    return 0
  }
  const seconds = /^\d{1,15}$/.test(raw) ? Number(raw) : Number.NaN
  if (!Number.isSafeInteger(seconds)) {
    throw new PackError('SOURCE_DATE_EPOCH precisa ser um inteiro de segundos (só dígitos)')
  }
  return seconds
}

function deterministicTar(vercelDir: string): Buffer {
  const tar = findOnSafePath('tar')
  const version = run(tar, ['--version']).toString('utf8')
  if (!version.includes('GNU tar')) {
    throw new PackError('é preciso o GNU tar (runner Ubuntu); bsdtar não garante determinismo')
  }
  return run(tar, [
    '--create',
    '--file=-',
    `--directory=${vercelDir}`,
    '--sort=name',
    '--format=pax',
    '--pax-option=exthdr.name=%d/PaxHeaders/%f,delete=atime,delete=ctime',
    `--mtime=@${String(sourceDateEpoch())}`,
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    'output',
  ])
}

function main(): void {
  const selected = parseTarget()
  const vercelDir = findVercelDir()
  const outputDir = join(vercelDir, 'output')
  if (!existsSync(join(outputDir, 'config.json'))) {
    throw new PackError(`${outputDir}/config.json não existe; rode \`vercel build\` antes`)
  }

  const entries = walk(outputDir)
  assertSymlinksInside(outputDir, entries)
  assertNoEnvAssignments(entries, envAssignmentPattern(knownEnvNames([selected.envFile])))
  runGitleaks(outputDir)

  const tarball = gzipSync(deterministicTar(vercelDir), { level: 9 })
  const sha256 = createHash('sha256').update(tarball).digest('hex')
  // Defesa em profundidade: um link simbólico em `dist/` não leva a escrita para fora do repo.
  const out = resolveInsideRoot(REPO_ROOT, selected.out, REPO_ROOT)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, tarball)
  writeFileSync(`${out}.sha256`, `${sha256}  ${basename(out)}\n`)

  const githubOutput = env['GITHUB_OUTPUT']
  if (githubOutput !== undefined && githubOutput !== '') {
    appendFileSync(
      githubOutput,
      `tarball=${out}\nsha256=${sha256}\nbytes=${String(tarball.length)}\n`,
    )
  }
  const files = entries.filter((e) => e.kind === 'file').length
  console.log(
    JSON.stringify({ env: selected.name, tarball: out, sha256, bytes: tarball.length, files }),
  )
}

try {
  main()
} catch (error) {
  console.error(`pack-vercel-output: ${error instanceof Error ? error.message : String(error)}`)
  if (error instanceof UsageError) {
    console.error(USAGE)
  }
  // `exitCode` em vez de `exit()`: no Windows, sair com a escrita no stderr ainda pendente aborta o
  // Node (assert do libuv) e troca o código de saída.
  process.exitCode = error instanceof UsageError ? 2 : 1
}
