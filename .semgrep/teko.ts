// biome-ignore-all lint: fixture do `semgrep test` (código propositalmente proibido; não é compilado nem executado)
// biome-ignore-all assist/source/organizeImports: cada import é um caso de teste anotado e não pode ser fundido
// Fixture das regras de .semgrep/teko.yml. As anotações de teste do Semgrep marcam a linha
// seguinte como achado esperado ou como falso positivo que a regra não pode reportar.

// ok: teko-external-fetch-only-via-safe-fetcher
import type { IncomingMessage } from 'node:http'
// ruleid: teko-external-fetch-only-via-safe-fetcher
import { request as httpRequest } from 'node:http'
// ok: teko-external-fetch-only-via-safe-fetcher
import { STATUS_CODES } from 'node:http'
import * as https from 'node:https'
// ruleid: teko-env-only-in-config
import { env } from 'node:process'
import * as proc from 'node:process'
import procDefault from 'process'
// ruleid: teko-vercel-functions-only-in-platform-adapter
import { waitUntil } from '@vercel/functions'
// ruleid: teko-external-fetch-only-via-safe-fetcher
import axios from 'axios'
import { sql } from 'drizzle-orm'
// ruleid: teko-no-rehype-raw
import rehypeRaw from 'rehype-raw'
// ruleid: teko-external-fetch-only-via-safe-fetcher
import { request as undiciRequest } from 'undici'

declare const userInput: string
declare const safeFetcher: { fetch(url: string): Promise<Response> }
declare const message: IncomingMessage

// --- teko-web-no-route-handlers (este arquivo faz o papel de um route.ts) ---
// ruleid: teko-web-no-route-handlers
export async function GET(): Promise<Response> {
  return new Response('nope')
}

// --- teko-web-no-server-actions ---
async function saveDraft(): Promise<void> {
  // ruleid: teko-web-no-server-actions
  'use server'
}
// ok: teko-web-no-server-actions
const notADirective = 'we use server-side rendering nowhere'

// --- teko-no-sql-raw-non-literal ---
const LIMIT_CLAUSE = 'limit 10'
// ruleid: teko-no-sql-raw-non-literal
sql.raw(userInput)
// ruleid: teko-no-sql-raw-non-literal
sql.raw(`order by ${userInput}`)
// ok: teko-no-sql-raw-non-literal
sql.raw('set local hnsw.ef_search = 100')
// ok: teko-no-sql-raw-non-literal
sql.raw(LIMIT_CLAUSE)
// ok: teko-no-sql-raw-non-literal
sql`select * from chunk where id = ${userInput}`

// --- teko-no-rehype-raw ---
// ruleid: teko-no-rehype-raw
const remarkRehypeOptions = { allowDangerousHtml: true }
// ok: teko-no-rehype-raw
const safeRemarkRehypeOptions = { allowDangerousHtml: false }

// --- teko-env-only-in-config ---
// ruleid: teko-env-only-in-config
const port = process.env.PORT
// ruleid: teko-env-only-in-config
const all = process.env
// ruleid: teko-env-only-in-config
const viaGlobal = globalThis.process.env
// ok: teko-env-only-in-config
const uptime = process.uptime()
// ruleid: teko-env-only-in-config
const viaNamespace = proc.env.PORT
// ruleid: teko-env-only-in-config
const viaDefault = procDefault.env
// ruleid: teko-env-only-in-config
const viaNamespaceIndex = proc['env']
// ruleid: teko-env-only-in-config
const viaRequire = require('node:process').env.PORT
// ruleid: teko-env-only-in-config
const { env: requiredEnv } = require('process')
const requiredProcess = require('node:process')
// ruleid: teko-env-only-in-config
const viaRequiredBinding = requiredProcess.env
// ok: teko-env-only-in-config
const namespaceUptime = proc.uptime()
// ok: teko-env-only-in-config
const requiredCwd = require('node:process').cwd()

// --- teko-external-fetch-only-via-safe-fetcher ---
// ruleid: teko-external-fetch-only-via-safe-fetcher
await fetch('https://www.gov.br/receitafederal')
// ruleid: teko-external-fetch-only-via-safe-fetcher
await globalThis.fetch(userInput)
// ruleid: teko-external-fetch-only-via-safe-fetcher
https.get('https://example.com')
// ruleid: teko-external-fetch-only-via-safe-fetcher
require('node:https').get(userInput)
// ruleid: teko-external-fetch-only-via-safe-fetcher
require('http').request(userInput)
const requiredHttps = require('https')
// ruleid: teko-external-fetch-only-via-safe-fetcher
requiredHttps.request(userInput)
// ruleid: teko-external-fetch-only-via-safe-fetcher
const { get: requiredGet } = require('node:http')
// ok: teko-external-fetch-only-via-safe-fetcher
const requiredStatusCodes = require('node:http').STATUS_CODES
// ok: teko-external-fetch-only-via-safe-fetcher
await safeFetcher.fetch('https://www.gov.br/receitafederal')
// ok: teko-external-fetch-only-via-safe-fetcher
const headers = new Map<string, string>().get('x-request-id')

// --- teko-vercel-functions-only-in-platform-adapter ---
// ruleid: teko-vercel-functions-only-in-platform-adapter
const functions = await import('@vercel/functions')
// ok: teko-vercel-functions-only-in-platform-adapter
const otel = await import('@opentelemetry/api')
// Reexportações (este arquivo também faz o papel de route.ts, então todo `export` é achado de
// teko-web-no-route-handlers; a regra da Vercel não pode disparar na última).
// ruleid: teko-vercel-functions-only-in-platform-adapter, teko-web-no-route-handlers
export * from '@vercel/functions'
// ruleid: teko-vercel-functions-only-in-platform-adapter, teko-web-no-route-handlers
export * as vercelFunctions from '@vercel/functions'
// ruleid: teko-vercel-functions-only-in-platform-adapter, teko-web-no-route-handlers
export { waitUntil as scheduleAfterResponse } from '@vercel/functions'
// ruleid: teko-vercel-functions-only-in-platform-adapter, teko-web-no-route-handlers
export type { Geo } from '@vercel/functions/headers'
// ruleid: teko-web-no-route-handlers
export { trace } from '@opentelemetry/api'
// ruleid: teko-env-only-in-config, teko-web-no-route-handlers
export { env as processEnv } from 'node:process'
// ruleid: teko-web-no-route-handlers
export { cwd } from 'node:process'

void [
  rehypeRaw,
  waitUntil,
  undiciRequest,
  httpRequest,
  STATUS_CODES,
  axios,
  // Uso do env importado de node:process (o Semgrep resolve o binding).
  // ruleid: teko-env-only-in-config
  env,
  message,
  saveDraft,
  notADirective,
  remarkRehypeOptions,
  safeRemarkRehypeOptions,
  port,
  all,
  viaGlobal,
  uptime,
  viaNamespace,
  viaDefault,
  viaNamespaceIndex,
  viaRequire,
  // ruleid: teko-env-only-in-config
  requiredEnv,
  viaRequiredBinding,
  namespaceUptime,
  requiredCwd,
  requiredGet,
  requiredStatusCodes,
  headers,
  functions,
  otel,
]
