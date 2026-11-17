import { context, propagation, trace } from '@opentelemetry/api'
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node'
import { TekoSampler } from '../sampler.ts'

/**
 * Provider de traces global com exporter em memória, para os testes que conferem spans criados
 * pela API global (`withSpan`, `pg`, o `@fastify/otel`). `stop()` desfaz o registro global.
 */
export interface InMemoryTracing {
  readonly provider: NodeTracerProvider
  readonly exporter: InMemorySpanExporter
  spans(): ReadableSpan[]
  stop(): Promise<void>
}

export function registerInMemoryTracing(): InMemoryTracing {
  const exporter = new InMemorySpanExporter()
  const provider = new NodeTracerProvider({
    sampler: new TekoSampler(),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })
  provider.register()
  return {
    provider,
    exporter,
    spans: () => exporter.getFinishedSpans(),
    stop: async () => {
      await provider.shutdown()
      trace.disable()
      context.disable()
      propagation.disable()
    },
  }
}
