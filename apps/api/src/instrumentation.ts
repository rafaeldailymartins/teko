import type { SpanProcessor } from '@opentelemetry/sdk-trace-node'
import { startTelemetry, type TelemetryRuntime } from '#adapters/out/telemetry/sdk.ts'
import type { Env } from './config/env.ts'

/**
 * Sobe o SDK do OpenTelemetry a partir do env já validado. Chamado por `server.ts` antes do
 * `import()` dinâmico da raiz de composição: o provider global, o contexto assíncrono
 * (`AsyncLocalStorage`) e o propagador W3C ficam prontos antes de qualquer módulo da aplicação
 * criar spans ou loggers. Sem `node --import` (a Vercel não oferece), este é o ponto mais cedo.
 *
 * Sem `OTEL_EXPORTER_OTLP_ENDPOINT`, nada é exportado (ver `adapters/out/telemetry/sdk.ts`).
 */

/**
 * Ponto de extensão dos span processors que entram no mesmo provider, além do de exportação ao
 * Grafana: o `add-llm-tracing-langfuse` devolve aqui o `LangfuseSpanProcessor` (com o mesmo
 * `trace_id`). Hoje, nenhum.
 */
export function additionalSpanProcessors(_env: Env): SpanProcessor[] {
  return []
}

export function startInstrumentation(env: Env): TelemetryRuntime {
  return startTelemetry({
    identity: {
      serviceVersion: env.APP_VERSION,
      gitSha: env.GIT_SHA,
      environment: env.APP_ENV,
      region: env.VERCEL_REGION ?? null,
    },
    otlp:
      env.OTEL_EXPORTER_OTLP_ENDPOINT === undefined
        ? null
        : {
            endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
            headers: env.OTEL_EXPORTER_OTLP_HEADERS ?? {},
          },
    spanProcessors: additionalSpanProcessors(env),
    metricsTemporality: env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE,
  })
}
