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
 *   JSON `"NOME": "..."`), para os nomes de Config e de Sensitive de `infra/vercel/env.*.json`;
 * - o gitleaks (`gitleaks dir`) varre o conteúdo e precisa terminar limpo.
 *
 * O tar é determinístico: GNU tar com `--sort=name`, `--mtime` fixo (`SOURCE_DATE_EPOCH`, ou 0),
 * dono 0:0 numérico e cabeçalhos pax sem atime/ctime; o gzip do Node não grava nome nem data. Os
 * caminhos dentro do tar começam em `output/`, para extrair com `tar -xzf <arquivo> -C .vercel`.
 *
 * Uso (no runner Ubuntu do Actions, depois do `vercel build`):
 *   node scripts/pack-vercel-output.ts --out dist/teko-api-output.tgz \
 *     [--vercel-dir .vercel] [--env-file infra/vercel/env.production.json] [--gitleaks gitleaks]
 *
 * Argumentos (`scripts/lib/cli-guards.ts`): `--out`, `--vercel-dir` e `--env-file` são resolvidos
 * contra o cwd e precisam ficar dentro do repositório, com links resolvidos. `--gitleaks` aceita só
 * o nome `gitleaks` (procurado apenas em diretórios absolutos e protegidos do PATH) ou o caminho
 * absoluto de um binário que se chame `gitleaks` (`gitleaks.exe` no Windows), como o
 * `$RUNNER_TEMP/gitleaks` verificado por SHA-256 no CI. O `tar` também sai do PATH protegido.
 *
 * Saída: o tarball, `<tarball>.sha256` (formato do `sha256sum`) e, com `GITHUB_OUTPUT`, as saídas
 * `tarball`, `sha256` e `bytes`. Não usa dependências: só o Node 24 (type stripping).
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
import { env, exit } from 'node:process'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'
import {
  compareCodeUnits,
  findOnSafePath,
  resolveAllowedExecutable,
  resolveInsideRoot,
} from './lib/cli-guards.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const DEFAULT_ENV_FILES = ['env.production.json', 'env.staging.json'].map((name) =>
  join(REPO_ROOT, 'infra', 'vercel', name),
)
/** Nomes que nunca podem estar no output (dotenv do `vercel pull` e o link do projeto). */
const FORBIDDEN_NAME = /^(?:\.env(?:\..*)?|project\.json)$/
/**
 * Nomes genéricos demais para a busca (dependências trazem `"NODE_ENV": "production"` e afins);
 * nenhum deles é segredo.
 */
const GENERIC_ENV_NAMES: ReadonlySet<string> = new Set(['NODE_ENV', 'LOG_LEVEL'])
/** Tamanho máximo de arquivo varrido em busca de env vars (bundles maiores são raros). */
const MAX_SCAN_BYTES = 32 * 1024 * 1024

class PackError extends Error {}

interface Options {
  readonly vercelDir: string
  readonly out: string
  readonly envFiles: readonly string[]
  readonly gitleaks: string
}

function parseOptions(): Options {
  const { values } = parseArgs({
    options: {
      'vercel-dir': { type: 'string', default: '.vercel' },
      out: { type: 'string' },
      'env-file': { type: 'string', multiple: true },
      gitleaks: { type: 'string', default: 'gitleaks' },
    },
    strict: true,
  })
  if (values.out === undefined) {
    throw new PackError('--out <arquivo.tgz> é obrigatório')
  }
  // Todo caminho fica dentro do repositório (links resolvidos) e sai absoluto, então nunca vira
  // opção do tar ou do gitleaks. O executável sai da allowlist (ver `resolveAllowedExecutable`).
  return {
    vercelDir: resolveInsideRoot(REPO_ROOT, values['vercel-dir']),
    out: resolveInsideRoot(REPO_ROOT, values.out),
    envFiles: (values['env-file'] ?? DEFAULT_ENV_FILES).map((file) =>
      resolveInsideRoot(REPO_ROOT, file),
    ),
    gitleaks: resolveAllowedExecutable(values.gitleaks, 'gitleaks'),
  }
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
 * `executable` é sempre um caminho absoluto já validado (`findOnSafePath` ou
 * `resolveAllowedExecutable`), e o spawn é sem shell, com argumentos em array.
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

function runGitleaks(gitleaks: string, outputDir: string): void {
  // --redact: o log do Actions nunca mostra o valor encontrado.
  run(gitleaks, ['dir', outputDir, '--no-banner', '--redact', '--exit-code', '1'])
}

function sourceDateEpoch(): number {
  const raw = env['SOURCE_DATE_EPOCH']
  return raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : 0
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
  const options = parseOptions()
  const outputDir = join(options.vercelDir, 'output')
  if (!existsSync(join(outputDir, 'config.json'))) {
    throw new PackError(`${outputDir}/config.json não existe; rode \`vercel build\` antes`)
  }

  const entries = walk(outputDir)
  assertSymlinksInside(outputDir, entries)
  assertNoEnvAssignments(entries, envAssignmentPattern(knownEnvNames(options.envFiles)))
  runGitleaks(options.gitleaks, outputDir)

  const tarball = gzipSync(deterministicTar(options.vercelDir), { level: 9 })
  const sha256 = createHash('sha256').update(tarball).digest('hex')
  mkdirSync(dirname(options.out), { recursive: true })
  writeFileSync(options.out, tarball)
  writeFileSync(`${options.out}.sha256`, `${sha256}  ${basename(options.out)}\n`)

  const githubOutput = env['GITHUB_OUTPUT']
  if (githubOutput !== undefined && githubOutput !== '') {
    appendFileSync(
      githubOutput,
      `tarball=${options.out}\nsha256=${sha256}\nbytes=${String(tarball.length)}\n`,
    )
  }
  const files = entries.filter((e) => e.kind === 'file').length
  console.log(JSON.stringify({ tarball: options.out, sha256, bytes: tarball.length, files }))
}

try {
  main()
} catch (error) {
  console.error(`pack-vercel-output: ${error instanceof Error ? error.message : String(error)}`)
  exit(1)
}
