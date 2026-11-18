import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { after, before, describe, it } from 'node:test'
import { STATIC_HEADERS } from './lib/static-site-policy.ts'
import {
  BYPASS_ENV,
  BYPASS_HEADER,
  canonicalOriginOf,
  isDeploymentUrl,
  legacyOriginOf,
  type MainDeps,
  main,
  parseCli,
  runSmoke,
  type SmokeTargets,
  singleLine,
  summaryMarkdown,
  UsageError,
} from './smoke.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const SHA = 'a'.repeat(40)
const OLD_SHA = 'b'.repeat(40)
const SECRET = 'segredo-de-bypass-de-teste'
const CSP =
  "default-src 'self'; script-src 'self' 'sha256-abc='; frame-ancestors 'none'; object-src 'none'"

interface FakeOptions {
  /** Sem este header de bypass, 401 (Deployment Protection da URL única). */
  protectedSecret?: string
  /** gitSha servido em cada chamada sucessiva do `/healthz` (o último se repete). */
  shas?: string[]
  env?: string
  coverageCache?: string
  csp?: string | null
  wafStatus?: number
  /** Origem do `WEB_ORIGIN` da API (o `Origin` aceito). */
  webOrigin?: () => string
}

interface Fake {
  readonly url: string
  readonly requests: { path: string; headers: IncomingMessage['headers'] }[]
  close(): Promise<void>
}

function send(
  res: ServerResponse,
  status: number,
  headers: Record<string, string>,
  body = '',
): void {
  res.writeHead(status, headers)
  res.end(body)
}

const API_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'private, no-store',
  vary: 'Cookie',
}

/** Uma deployment da Vercel do Tekó em miniatura: as rotas e respostas que o smoke olha. */
async function fakeVercel(options: FakeOptions = {}): Promise<Fake> {
  const requests: Fake['requests'] = []
  const shas = [...(options.shas ?? [SHA])]
  const server: Server = createServer((req, res) => {
    const path = req.url ?? '/'
    requests.push({ path, headers: req.headers })
    if (
      options.protectedSecret !== undefined &&
      req.headers[BYPASS_HEADER] !== options.protectedSecret
    ) {
      send(res, 401, { 'content-type': 'text/html' }, '<html>Vercel Authentication</html>')
      return
    }
    if (path === '/healthz' || path === '/api/healthz') {
      const gitSha = shas.length > 1 ? shas.shift() : shas[0]
      const headers = path === '/healthz' ? { 'content-type': 'application/json' } : API_HEADERS
      send(
        res,
        200,
        headers,
        JSON.stringify({ status: 'ok', version: '0.0.0', gitSha, env: options.env ?? 'staging' }),
      )
      return
    }
    if (path === '/') {
      const english = /^\s*en/.test(String(req.headers['accept-language'] ?? ''))
      send(res, 302, {
        location: english ? '/en/' : '/pt-BR/',
        'cache-control': 'private, no-store',
        vary: 'Accept-Language',
      })
      return
    }
    if (path === '/pt-BR/' || path === '/en/') {
      const locale = path.slice(1, -1)
      const csp = options.csp === undefined ? CSP : options.csp
      send(
        res,
        200,
        {
          'content-type': 'text/html; charset=utf-8',
          ...STATIC_HEADERS,
          ...(csp === null ? {} : { 'content-security-policy': csp }),
        },
        `<!DOCTYPE html><html lang="${locale}"><body>Tekó</body></html>`,
      )
      return
    }
    if (path === '/api/v1/coverage') {
      send(
        res,
        200,
        {
          ...API_HEADERS,
          ...(options.coverageCache === undefined
            ? {}
            : { 'x-vercel-cache': options.coverageCache }),
        },
        JSON.stringify({ corpusVersion: 7, families: [{ family: 'rcte' }] }),
      )
      return
    }
    if (path.startsWith('/api/v1/questions/') && req.method === 'POST') {
      const allowed = options.webOrigin?.() ?? ''
      const problem = (status: number, code: string) =>
        send(
          res,
          status,
          { ...API_HEADERS, 'content-type': 'application/problem+json' },
          JSON.stringify({ status, code }),
        )
      if (req.headers.origin !== allowed) {
        problem(403, 'forbidden')
      } else {
        problem(401, 'unauthenticated')
      }
      return
    }
    if (path.startsWith('/api/')) {
      send(res, options.wafStatus ?? 403, { 'content-type': 'text/plain' }, 'Forbidden')
      return
    }
    send(res, 404, { 'content-type': 'text/html' })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    url,
    requests,
    close: () => new Promise<void>((done) => server.close(() => done())),
  }
}

/** Domínio antigo: tudo vira 308 para o canônico, com o caminho. */
async function fakeLegacy(target: () => string, location?: string): Promise<Fake> {
  const requests: Fake['requests'] = []
  const server = createServer((req, res) => {
    requests.push({ path: req.url ?? '/', headers: req.headers })
    send(res, 308, { location: location ?? `${target()}${req.url ?? '/'}` })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { url, requests, close: () => new Promise<void>((done) => server.close(() => done())) }
}

function targetsFor(fake: Fake, legacy: Fake, overrides: Partial<SmokeTargets> = {}): SmokeTargets {
  return {
    env: 'staging',
    mode: 'canonical',
    baseUrl: fake.url,
    canonicalOrigin: fake.url,
    legacyOrigin: legacy.url,
    expectedSha: SHA,
    ...overrides,
  }
}

const noSleep = async () => {}

describe('runSmoke no modo canonical', () => {
  let fake: Fake
  let legacy: Fake
  before(async () => {
    fake = await fakeVercel({ webOrigin: () => fake.url })
    legacy = await fakeLegacy(() => fake.url)
  })
  after(async () => {
    await fake.close()
    await legacy.close()
  })

  it('passa com a deployment certa e confere WAF e domínio antigo, sem bypass', async () => {
    const report = await runSmoke(targetsFor(fake, legacy), { fetch, sleep: noSleep })
    assert.equal(report.ok, true, JSON.stringify(report.checks.filter((check) => !check.ok)))
    assert.deepEqual(
      report.checks.map((check) => check.name),
      [
        'healthz',
        'api-healthz',
        'root-redirect-en',
        'root-redirect-pt-BR',
        'page-pt-BR',
        'page-en',
        'coverage',
        'coverage-again',
        'stream-without-session',
        'stream-foreign-origin',
        'waf-unknown-api',
        'legacy-domain',
        'legacy-domain-api',
      ],
    )
    assert.ok(fake.requests.every((request) => request.headers[BYPASS_HEADER] === undefined))
    assert.ok(report.checks.every((check) => check.durationMs >= 0 && check.attempts === 1))
    assert.equal(report.env, 'staging')
    assert.equal(report.mode, 'canonical')
  })
})

describe('runSmoke: repetição do /healthz logo depois do promote', () => {
  it('repete enquanto o sha é o anterior e passa quando o novo chega', async () => {
    const fake = await fakeVercel({ shas: [OLD_SHA, OLD_SHA, SHA], webOrigin: () => fake.url })
    const legacy = await fakeLegacy(() => fake.url)
    const sleeps: number[] = []
    try {
      const report = await runSmoke(targetsFor(fake, legacy), {
        fetch,
        sleep: async (ms) => {
          sleeps.push(ms)
        },
        shaRetry: { attempts: 5, delayMs: 7 },
      })
      assert.equal(report.ok, true)
      assert.equal(report.checks[0]?.attempts, 3)
      assert.deepEqual(sleeps, [7, 7])
    } finally {
      await fake.close()
      await legacy.close()
    }
  })

  it('desiste depois das tentativas e mostra o sha servido', async () => {
    const fake = await fakeVercel({ shas: [OLD_SHA], webOrigin: () => fake.url })
    const legacy = await fakeLegacy(() => fake.url)
    try {
      const report = await runSmoke(targetsFor(fake, legacy), {
        fetch,
        sleep: noSleep,
        shaRetry: { attempts: 3, delayMs: 0 },
      })
      assert.equal(report.ok, false)
      const health = report.checks[0]
      assert.equal(health?.ok, false)
      assert.equal(health?.attempts, 3)
      assert.match(health?.detail ?? '', new RegExp(`gitSha "${OLD_SHA}", esperado ${SHA}`))
    } finally {
      await fake.close()
      await legacy.close()
    }
  })

  it('no modo deployment não repete: a URL única é de uma deployment só', async () => {
    const fake = await fakeVercel({
      shas: [OLD_SHA, SHA],
      protectedSecret: SECRET,
      webOrigin: () => 'https://x',
    })
    const legacy = await fakeLegacy(() => fake.url)
    try {
      const report = await runSmoke(targetsFor(fake, legacy, { mode: 'deployment' }), {
        fetch,
        bypass: SECRET,
        sleep: noSleep,
      })
      assert.equal(report.checks[0]?.ok, false)
      assert.equal(report.checks[0]?.attempts, 1)
    } finally {
      await fake.close()
      await legacy.close()
    }
  })
})

describe('runSmoke no modo deployment', () => {
  it('manda o bypass em todo request, menos na checagem da proteção, e nunca o devolve', async () => {
    const fake = await fakeVercel({
      protectedSecret: SECRET,
      webOrigin: () => 'https://tekoia-staging.vercel.app',
    })
    const legacy = await fakeLegacy(() => fake.url)
    try {
      const report = await runSmoke(
        targetsFor(fake, legacy, {
          mode: 'deployment',
          canonicalOrigin: 'https://tekoia-staging.vercel.app',
        }),
        { fetch, bypass: SECRET, sleep: noSleep },
      )
      assert.equal(report.ok, true, JSON.stringify(report.checks.filter((check) => !check.ok)))
      const names = report.checks.map((check) => check.name)
      assert.equal(names.at(-1), 'deployment-protection')
      assert.ok(!names.includes('waf-unknown-api') && !names.includes('legacy-domain'))
      assert.equal(legacy.requests.length, 0)
      const withoutBypass = fake.requests.filter(
        (request) => request.headers[BYPASS_HEADER] === undefined,
      )
      assert.deepEqual(
        withoutBypass.map((request) => request.path),
        ['/healthz'],
      )
      assert.ok(!JSON.stringify(report).includes(SECRET))
      assert.ok(!summaryMarkdown(report).includes(SECRET))
    } finally {
      await fake.close()
      await legacy.close()
    }
  })

  it('falha se a URL única responde sem o bypass', async () => {
    const fake = await fakeVercel({ webOrigin: () => 'https://tekoia-staging.vercel.app' })
    const legacy = await fakeLegacy(() => fake.url)
    try {
      const report = await runSmoke(
        targetsFor(fake, legacy, {
          mode: 'deployment',
          canonicalOrigin: 'https://tekoia-staging.vercel.app',
        }),
        { fetch, bypass: SECRET, sleep: noSleep },
      )
      const protection = report.checks.find((check) => check.name === 'deployment-protection')
      assert.equal(protection?.ok, false)
      assert.match(protection?.detail ?? '', /não está protegida/)
      assert.equal(report.ok, false)
    } finally {
      await fake.close()
      await legacy.close()
    }
  })

  it('aceita o redirect para o login da Vercel como proteção', async () => {
    const server = createServer((req, res) => {
      if (req.headers[BYPASS_HEADER] === undefined) {
        send(res, 302, { location: 'https://vercel.com/sso-api?url=x' })
      } else {
        send(res, 500, {})
      }
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    try {
      const report = await runSmoke(
        {
          env: 'staging',
          mode: 'deployment',
          baseUrl: url,
          canonicalOrigin: 'https://tekoia-staging.vercel.app',
          legacyOrigin: 'https://teko-api-staging.vercel.app',
          expectedSha: SHA,
        },
        { fetch, bypass: SECRET, sleep: noSleep },
      )
      assert.equal(report.checks.find((check) => check.name === 'deployment-protection')?.ok, true)
    } finally {
      await new Promise<void>((done) => server.close(() => done()))
    }
  })
})

describe('runSmoke: cada checagem reprova o que deve', () => {
  async function failuresWith(options: FakeOptions, legacyLocation?: string): Promise<string[]> {
    const fake = await fakeVercel({ ...options, webOrigin: () => fake.url })
    const legacy = await fakeLegacy(() => fake.url, legacyLocation)
    try {
      const report = await runSmoke(targetsFor(fake, legacy), { fetch, sleep: noSleep })
      return report.checks.filter((check) => !check.ok).map((check) => check.name)
    } finally {
      await fake.close()
      await legacy.close()
    }
  }

  it('cobertura servida do cache da CDN', async () => {
    assert.deepEqual(await failuresWith({ coverageCache: 'HIT' }), ['coverage', 'coverage-again'])
  })

  it('página sem CSP', async () => {
    assert.deepEqual(await failuresWith({ csp: null }), ['page-pt-BR', 'page-en'])
  })

  it('CSP com unsafe-inline em script-src', async () => {
    assert.deepEqual(
      await failuresWith({
        csp: "default-src 'self'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
      }),
      ['page-pt-BR', 'page-en'],
    )
  })

  it('WAF desligado (a API responde 404)', async () => {
    assert.deepEqual(await failuresWith({ wafStatus: 404 }), ['waf-unknown-api'])
  })

  it('domínio antigo redirecionando para outro lugar', async () => {
    assert.deepEqual(await failuresWith({}, 'https://evil.example/'), [
      'legacy-domain',
      'legacy-domain-api',
    ])
  })

  it('env errado no /healthz', async () => {
    assert.deepEqual(await failuresWith({ env: 'production' }), ['healthz', 'api-healthz'])
  })

  it('redirect inesperado mostra o destino sem a query (login da Vercel ou rota da raiz)', async () => {
    const server = createServer((request, response) => {
      const location =
        request.url === '/healthz'
          ? 'https://vercel.com/sso-api?url=x&nonce=NAO-PODE-APARECER'
          : '/en/'
      response.writeHead(302, { location }).end()
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    try {
      const report = await runSmoke(
        {
          env: 'staging',
          mode: 'canonical',
          baseUrl: url,
          canonicalOrigin: url,
          legacyOrigin: url,
          expectedSha: SHA,
        },
        { fetch, sleep: noSleep },
      )
      const detail = (name: string) => report.checks.find((check) => check.name === name)?.detail
      assert.match(
        detail('healthz') ?? '',
        /status 302, esperado 200 \(para https:\/\/vercel\.com\/sso-api\)/,
      )
      assert.match(detail('coverage') ?? '', /status 302, esperado 200 \(para \/en\/\)/)
      assert.ok(!JSON.stringify(report).includes('NAO-PODE-APARECER'))
    } finally {
      await new Promise<void>((done) => server.close(() => done()))
    }
  })

  it('request que não chega: falha com o motivo, sem lançar', async () => {
    const report = await runSmoke(
      {
        env: 'staging',
        mode: 'canonical',
        baseUrl: 'http://127.0.0.1:9',
        canonicalOrigin: 'http://127.0.0.1:9',
        legacyOrigin: 'http://127.0.0.1:9',
        expectedSha: SHA,
      },
      { fetch, sleep: noSleep },
    )
    assert.equal(report.ok, false)
    assert.ok(
      report.checks.every((check) => check.status === null && /request falhou/.test(check.detail)),
    )
  })
})

describe('saída do log', () => {
  it('uma linha por chamada: CR e LF da resposta não forjam comando do Actions', () => {
    assert.equal(
      singleLine('FAIL x: location "a\r\n::error::forjado"'),
      'FAIL x: location "a  ::error::forjado"',
    )
  })
})

describe('linha de comando', () => {
  const staging = JSON.parse(
    readFileSync(join(REPO_ROOT, 'infra', 'vercel', 'env.staging.json'), 'utf8'),
  ) as unknown
  const production = JSON.parse(
    readFileSync(join(REPO_ROOT, 'infra', 'vercel', 'env.production.json'), 'utf8'),
  ) as unknown

  it('o canônico e o domínio antigo vêm do env.<env>.json e das rotas da Vercel', () => {
    assert.equal(canonicalOriginOf(staging), 'https://tekoia-staging.vercel.app')
    assert.equal(canonicalOriginOf(production), 'https://tekoia.vercel.app')
    assert.equal(
      legacyOriginOf('https://tekoia-staging.vercel.app'),
      'https://teko-api-staging.vercel.app',
    )
    assert.equal(legacyOriginOf('https://tekoia.vercel.app'), 'https://teko-api.vercel.app')
    assert.throws(() => legacyOriginOf('https://outro.vercel.app'))
    assert.throws(() => canonicalOriginOf({ config: { WEB_ORIGIN: { value: 'http://x' } } }))
  })

  it('URL única: só https em vercel.app do projeto do ambiente, sem caminho nem query', () => {
    assert.equal(isDeploymentUrl('https://tekoia-staging-abc123-time.vercel.app', 'staging'), true)
    assert.equal(isDeploymentUrl('https://tekoia-staging-abc123-time.vercel.app/', 'staging'), true)
    assert.equal(isDeploymentUrl('https://tekoia-abc123-time.vercel.app', 'production'), true)
    for (const [url, env] of [
      ['https://tekoia-staging-abc123-time.vercel.app', 'production'],
      ['https://tekoia-staging.vercel.app', 'staging'],
      ['https://tekoia.vercel.app', 'production'],
      ['http://tekoia-abc.vercel.app', 'production'],
      ['https://tekoia-abc.vercel.app.evil.example', 'production'],
      ['https://tekoia-abc.vercel.app:8443', 'production'],
      ['https://tekoia-abc.vercel.app/healthz', 'production'],
      ['https://tekoia-abc.vercel.app/?x=1', 'production'],
      ['https://user@tekoia-abc.vercel.app', 'production'],
      ['https://outro-abc.vercel.app', 'staging'],
      ['não é url', 'staging'],
    ] as const) {
      assert.equal(isDeploymentUrl(url, env), false, url)
    }
  })

  it('valida o contrato e monta os alvos', () => {
    const options = parseCli([
      '--env',
      'staging',
      '--mode',
      'canonical',
      '--base-url',
      'https://tekoia-staging.vercel.app/',
      '--expected-sha',
      SHA,
      '--out',
      'reports/smoke.json',
    ])
    assert.deepEqual(options, {
      targets: {
        env: 'staging',
        mode: 'canonical',
        baseUrl: 'https://tekoia-staging.vercel.app',
        canonicalOrigin: 'https://tekoia-staging.vercel.app',
        legacyOrigin: 'https://teko-api-staging.vercel.app',
        expectedSha: SHA,
      },
      out: 'reports/smoke.json',
    })
  })

  it('recusa argumento fora do contrato', () => {
    const base = [
      '--env',
      'production',
      '--mode',
      'canonical',
      '--base-url',
      'https://tekoia.vercel.app',
      '--expected-sha',
      SHA,
    ]
    const replace = (flag: string, value: string) => {
      const args = [...base]
      args[args.indexOf(flag) + 1] = value
      return args
    }
    for (const args of [
      replace('--env', 'preview'),
      replace('--mode', 'preview'),
      replace('--expected-sha', 'abc1234'),
      replace('--expected-sha', SHA.toUpperCase()),
      replace('--base-url', 'https://tekoia-staging.vercel.app'),
      replace('--base-url', 'https://evil.example'),
      [...replace('--mode', 'deployment')],
      [...base, '--out', 'relatorio.txt'],
      [...base, '--extra', 'x'],
      [...base, 'posicional'],
    ]) {
      assert.throws(() => parseCli(args), UsageError, args.join(' '))
    }
  })
})

describe('main', () => {
  let fake: Fake
  let legacy: Fake
  let dir: string
  const canonical = 'https://tekoia-staging.vercel.app'
  const legacyHost = 'https://teko-api-staging.vercel.app'

  before(async () => {
    fake = await fakeVercel({ webOrigin: () => canonical })
    legacy = await fakeLegacy(() => canonical)
    dir = mkdtempSync(join(tmpdir(), 'teko-smoke-'))
  })
  after(async () => {
    await fake.close()
    await legacy.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** `fetch` que leva os hosts reais aos servidores locais (o resto do caminho igual ao real). */
  const routed: typeof fetch = (input, init) => {
    const url = String(input).replace(canonical, fake.url).replace(legacyHost, legacy.url)
    return fetch(url, init)
  }

  function deps(
    env: Record<string, string | undefined> = {},
  ): MainDeps & { lines: string[]; errors: string[] } {
    const lines: string[] = []
    const errors: string[] = []
    return {
      env,
      fetch: routed,
      log: (line) => lines.push(line),
      error: (line) => errors.push(line),
      sleep: noSleep,
      resolveOut: (out) => join(dir, out),
      lines,
      errors,
    }
  }

  it('verde: sai 0, grava o relatório JSON e o resumo do job', async () => {
    const summary = join(dir, 'summary.md')
    const run = deps({ GITHUB_STEP_SUMMARY: summary })
    const code = await main(
      [
        '--env',
        'staging',
        '--mode',
        'canonical',
        '--base-url',
        canonical,
        '--expected-sha',
        SHA,
        '--out',
        'smoke.json',
      ],
      run,
    )
    assert.equal(code, 0, run.lines.join('\n'))
    const report = JSON.parse(readFileSync(join(dir, 'smoke.json'), 'utf8')) as {
      ok: boolean
      checks: unknown[]
    }
    assert.equal(report.ok, true)
    assert.equal(report.checks.length, 13)
    assert.match(readFileSync(summary, 'utf8'), /### Smoke staging \(canonical\): verde/)
    assert.match(run.lines.at(-1) ?? '', /^smoke verde: 13 checagens/)
  })

  it('vermelho: sai 1 com o sha errado', async () => {
    const run = deps()
    const code = await main(
      [
        '--env',
        'staging',
        '--mode',
        'canonical',
        '--base-url',
        canonical,
        '--expected-sha',
        OLD_SHA,
      ],
      { ...run, shaRetry: { attempts: 2, delayMs: 0 } },
    )
    assert.equal(code, 1)
    assert.match(run.lines.at(-1) ?? '', /^smoke vermelho: 2 de 13/)
  })

  it('uso inválido: sai 2 sem rede', async () => {
    let called = false
    const run = {
      ...deps(),
      fetch: (() => {
        called = true
        return Promise.reject(new Error('x'))
      }) as typeof fetch,
    }
    assert.equal(await main(['--env', 'staging'], run), 2)
    assert.equal(called, false)
    assert.match(run.errors[0] ?? '', /--mode precisa ser deployment\|canonical/)
  })

  it('modo deployment sem o segredo do bypass: sai 2', async () => {
    const run = deps()
    const code = await main(
      [
        '--env',
        'staging',
        '--mode',
        'deployment',
        '--base-url',
        'https://tekoia-staging-abc-time.vercel.app',
        '--expected-sha',
        SHA,
      ],
      run,
    )
    assert.equal(code, 2)
    assert.match(run.errors[0] ?? '', new RegExp(BYPASS_ENV))
  })

  it('--out fora do repositório: sai 2', async () => {
    const run = { ...deps(), resolveOut: undefined }
    const { resolveOut: _ignored, ...withoutResolver } = run
    const code = await main(
      [
        '--env',
        'staging',
        '--mode',
        'canonical',
        '--base-url',
        canonical,
        '--expected-sha',
        SHA,
        '--out',
        '../../fora-do-repo.json',
      ],
      withoutResolver,
    )
    assert.equal(code, 2)
    assert.match(run.errors[0] ?? '', /fora do repositório/)
  })

  it('o script de verdade sai 2 em argumento inválido', () => {
    const result = spawnSync(
      process.execPath,
      [join(REPO_ROOT, 'scripts', 'smoke.ts'), '--env', 'preview'],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      },
    )
    assert.equal(result.status, 2, result.stderr)
    assert.match(result.stderr, /uso: node scripts\/smoke\.ts/)
  })
})
