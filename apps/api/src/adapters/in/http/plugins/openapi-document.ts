import { compareCodeUnits } from '#domain/shared/compare-code-units.ts'

/**
 * Documento OpenAPI versionado da web (`apps/web/openapi.json`), fonte do cliente gerado
 * (`@hey-api/openapi-ts`). Sai do mesmo `/api/docs/json` que a API publica fora de produção,
 * normalizado para ser determinístico e para casar com o `baseUrl: '/api'` do cliente:
 *
 * - só os caminhos sob `/api/` entram, sem o prefixo (`/api/v1/me` vira `/v1/me`), e o prefixo
 *   vai para `servers: [{ url: '/api' }]` (o hey-api tira o `baseUrl` do primeiro server);
 *   `/healthz` (infraestrutura) fica de fora, a web não o chama;
 * - `info.version` é fixo (`v1`, o prefixo das rotas): a versão da build mudaria o arquivo a
 *   cada release e reprovaria o gate de drift sem mudança de contrato;
 * - caminhos e métodos em ordem estável (code units), JSON com 2 espaços e quebra de linha final.
 */

export const WEB_API_BASE_PATH = '/api'
export const OPENAPI_DOCUMENT_VERSION = 'v1'

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sortedEntries(object: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => compareCodeUnits(left, right)),
  )
}

/** Normaliza o documento servido em `/api/docs/json` no documento versionado da web. */
export function normalizeWebOpenApi(document: unknown): JsonObject {
  if (!isObject(document) || !isObject(document['paths']) || !isObject(document['info'])) {
    throw new Error('documento OpenAPI sem `info` ou `paths`')
  }
  const prefix = `${WEB_API_BASE_PATH}/`
  const paths: JsonObject = {}
  for (const [path, item] of Object.entries(document['paths'])) {
    if (path.startsWith(prefix) && isObject(item)) {
      paths[path.slice(WEB_API_BASE_PATH.length)] = sortedEntries(item)
    }
  }
  const { openapi, info, paths: _paths, servers: _servers, ...rest } = document
  return {
    openapi,
    info: { ...info, version: OPENAPI_DOCUMENT_VERSION },
    servers: [{ url: WEB_API_BASE_PATH }],
    ...rest,
    paths: sortedEntries(paths),
  }
}

/** Serialização estável (o arquivo versionado é exatamente esta string). */
export function serializeOpenApi(document: JsonObject): string {
  return `${JSON.stringify(document, null, 2)}\n`
}
