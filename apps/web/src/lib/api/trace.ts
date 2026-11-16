/**
 * Correlação com a telemetria da API (`docs/architecture/observabilidade.md`), sem SDK do OTel no
 * navegador (orçamento de bundle): cada requisição a `/api` leva um `traceparent` W3C novo, e a API
 * reaproveita o `trace_id` dele no trace (Grafana e Langfuse) e no `x-trace-id` da resposta, que a
 * UI mostra como "ID de suporte". A flag `sampled` vai desligada (o navegador não grava spans); a
 * API a ignora. Mesma origem: nada muda na CSP.
 */
export const TRACEPARENT_HEADER = 'traceparent'
export const TRACE_ID_HEADER = 'x-trace-id'

const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/

function randomHex(bytes: number): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('')
}

/** Id aleatório de `bytes` bytes que não é todo zero (inválido no W3C Trace Context). */
function nonZeroHex(bytes: number): string {
  const value = randomHex(bytes)
  return /^0+$/.test(value) ? nonZeroHex(bytes) : value
}

/** `traceparent` novo: versão 00, `trace_id` de 16 bytes, `parent_id` de 8 e flags 00. */
export function createTraceparent(): string {
  return `00-${nonZeroHex(16)}-${nonZeroHex(8)}-00`
}

/** `x-trace-id` da resposta, se tiver o formato do `trace_id` (32 hex). */
export function traceIdOf(response: Response | undefined): string | null {
  const value = response?.headers.get(TRACE_ID_HEADER)?.trim().toLowerCase() ?? null
  return value !== null && TRACE_ID_PATTERN.test(value) ? value : null
}

/** Põe um `traceparent` novo nos headers da requisição, se ela ainda não tiver um. */
export function withTraceparent(headers: Headers): Headers {
  if (!headers.has(TRACEPARENT_HEADER)) {
    headers.set(TRACEPARENT_HEADER, createTraceparent())
  }
  return headers
}
