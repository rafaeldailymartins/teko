import {
  type Attributes,
  type Context,
  isSpanContextValid,
  TraceFlags,
  trace,
} from '@opentelemetry/api'
import { type Sampler, SamplingDecision, type SamplingResult } from '@opentelemetry/sdk-trace-node'
import { ATTR_HTTP_ROUTE, ATTR_URL_PATH } from '@opentelemetry/semantic-conventions'

/**
 * Sampler da API (`docs/architecture/observabilidade.md`): sempre amostra (`AlwaysOn`), menos o
 * health check, e **não** é parent-based em relação ao navegador:
 *
 * - `/healthz` e `/api/healthz` (pelo `url.path` ou pelo `http.route` do span) nunca gravam: o
 *   Synthetic Monitoring bate neles a cada poucos minutos e não pode gastar cota de spans;
 * - pai remoto (o `traceparent` que o navegador gera por requisição): o `trace_id` dele é mantido
 *   (o SDK herda do pai), mas a flag `sampled` é ignorada, porque o navegador não grava spans;
 * - pai local (um span da própria API): segue a decisão dele, para os filhos de uma requisição
 *   descartada (o `/healthz`) não virarem spans soltos.
 */
const HEALTH_PATHS: ReadonlySet<string> = new Set(['/healthz', '/api/healthz'])

function pathOf(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const query = value.indexOf('?')
  return query === -1 ? value : value.slice(0, query)
}

export function isHealthCheck(attributes: Attributes): boolean {
  return [attributes[ATTR_URL_PATH], attributes[ATTR_HTTP_ROUTE]].some((value) => {
    const path = pathOf(value)
    return path !== null && HEALTH_PATHS.has(path)
  })
}

export class TekoSampler implements Sampler {
  shouldSample(
    context: Context,
    _traceId: string,
    _spanName: string,
    _spanKind: unknown,
    attributes: Attributes,
  ): SamplingResult {
    if (isHealthCheck(attributes)) {
      return { decision: SamplingDecision.NOT_RECORD }
    }
    const parent = trace.getSpanContext(context)
    if (
      parent !== undefined &&
      isSpanContextValid(parent) &&
      parent.isRemote !== true &&
      (parent.traceFlags & TraceFlags.SAMPLED) === 0
    ) {
      return { decision: SamplingDecision.NOT_RECORD }
    }
    return { decision: SamplingDecision.RECORD_AND_SAMPLED }
  }

  toString(): string {
    return 'TekoSampler{AlwaysOn, sem /healthz, ignora a flag sampled do pai remoto}'
  }
}
