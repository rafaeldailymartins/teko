import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_MAX_TRANSFER_RATIO, type GuardDeps, guard } from './neon-transfer-guard.ts'

const URL_STAGING = 'https://console.neon.tech/api/v2/projects/stg-456'
const ENV = { NEON_STAGING_PROJECT_ID: 'stg-456', NEON_API_KEY_STAGING: 'k2' }

function deps(
  env: GuardDeps['env'],
  responses: Record<string, Response>,
): GuardDeps & { lines: string[]; requests: string[] } {
  const lines: string[] = []
  const requests: string[] = []
  return {
    env,
    lines,
    requests,
    log: (line) => lines.push(line),
    fetch: (async (url: URL | string) => {
      requests.push(String(url))
      return responses[String(url)] ?? new Response('não encontrado', { status: 404 })
    }) as typeof fetch,
  }
}

const neon = (bytes: number) =>
  new Response(
    JSON.stringify({
      project: {
        compute_time_seconds: 3600,
        data_transfer_bytes: bytes,
        consumption_period_start: '2026-11-10T00:00:00Z',
      },
    }),
  )

const options = { allow: false, maxRatio: DEFAULT_MAX_TRANSFER_RATIO }

describe('guarda de transferência do Neon', () => {
  it('abaixo de 80%: passa, com o número no resumo', async () => {
    const d = deps(ENV, { [URL_STAGING]: neon(1_250_000_000) })
    const result = await guard(d, options)
    assert.equal(result.code, 0)
    assert.equal(result.ratio, 0.25)
    assert.equal(result.bytes, 1_250_000_000)
    assert.match(result.summary, /1\.25 GB de 5\.00 GB \(25\.0%\)/u)
    assert.deepEqual(d.lines, [])
    assert.deepEqual(d.requests, [URL_STAGING])
  })

  it('acima de 80%: para com ::error e aponta o runbook', async () => {
    const d = deps(ENV, { [URL_STAGING]: neon(4_100_000_000) })
    const result = await guard(d, options)
    assert.equal(result.code, 1)
    assert.equal(result.ratio, 0.82)
    assert.match(d.lines[0] ?? '', /^::error title=neon-transfer::teko-staging com 4\.10 GB/u)
    assert.match(d.lines[0] ?? '', /neon-suspended\.md/u)
    assert.match(result.summary, /run parado/u)
  })

  it('exatamente 80% ainda passa', async () => {
    const result = await guard(deps(ENV, { [URL_STAGING]: neon(4_000_000_000) }), options)
    assert.equal(result.code, 0)
  })

  it('allow_high_transfer libera com aviso', async () => {
    const d = deps(ENV, { [URL_STAGING]: neon(4_900_000_000) })
    const result = await guard(d, { ...options, allow: true })
    assert.equal(result.code, 0)
    assert.match(d.lines[0] ?? '', /^::warning title=neon-transfer::.*liberado/u)
    assert.match(result.summary, /liberado/u)
  })

  it('sem configuração ou com a API fora: não mede e para, salvo allow', async () => {
    const missing = deps({ NEON_API_KEY_STAGING: 'k2' }, {})
    const result = await guard(missing, options)
    assert.equal(result.code, 1)
    assert.equal(result.ratio, null)
    assert.match(missing.lines[0] ?? '', /falta NEON_STAGING_PROJECT_ID/u)
    assert.deepEqual(missing.requests, [])

    const down = deps(ENV, {})
    assert.equal((await guard(down, options)).code, 1)
    assert.match(down.lines[0] ?? '', /API do Neon respondeu 404/u)

    const allowed = deps(ENV, {})
    assert.equal((await guard(allowed, { ...options, allow: true })).code, 0)
  })

  it('resposta sem data_transfer_bytes não vale como zero', async () => {
    const body = new Response(
      JSON.stringify({
        project: { compute_time_seconds: 1, consumption_period_start: '2026-11-10T00:00:00Z' },
      }),
    )
    const d = deps(ENV, { [URL_STAGING]: body })
    assert.equal((await guard(d, options)).code, 1)
    assert.match(d.lines[0] ?? '', /sem compute_time_seconds, data_transfer_bytes/u)
  })
})
