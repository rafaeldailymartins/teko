import {
  type Attributes,
  context,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api'

/**
 * Spans criados à mão nos adapters de saída (`pg`, LLM, embeddings e reranker): o bundle do tsdown
 * não garante a auto-instrumentação por hook de módulo (`require-in-the-middle`), então cada
 * chamada externa abre o próprio span com `withSpan` ou `tracedIterable`.
 *
 * O tracer vem da API global: sem o SDK registrado (testes, CLI), os spans são no-op. Com ele, o
 * pai é o span ativo (o `request` do `@fastify/otel`), e o span sai pelos processors do provider
 * (Grafana e, a partir do `add-llm-tracing-langfuse`, o Langfuse) com o mesmo `trace_id`.
 */
export const TRACER_NAME = 'teko-api'

/**
 * O tracer é pedido à API a cada span, nunca guardado no carregamento do módulo: a
 * `@opentelemetry/api` 1.10 tem builds ESM e CJS separados, e o SDK (CJS) registra o provider no
 * proxy do build CJS. Um `ProxyTracer` guardado do build ESM nunca receberia o delegate; o
 * `getTracer` na hora lê o provider global, que os dois builds compartilham.
 */
function tracer() {
  return trace.getTracer(TRACER_NAME)
}

/**
 * Marca o span como falho com o tipo do erro (`error.type`). A mensagem não vai para o span: erros
 * do Postgres e dos provedores podem repetir valores da consulta ou do prompt (PII). O erro com
 * stack, saneado, é assunto do destino de erros (`ErrorReporterPort`).
 */
export function markFailed(span: Span, error: unknown): void {
  const type = error instanceof Error ? error.name : 'unknown'
  span.setAttribute('error.type', type)
  span.setStatus({ code: SpanStatusCode.ERROR, message: type })
}

/** Roda `fn` dentro de um span ativo de cliente (filho do span atual), que termina com ela. */
export function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer().startActiveSpan(name, { kind: SpanKind.CLIENT, attributes }, async (span) => {
    try {
      return await fn(span)
    } catch (error) {
      markFailed(span, error)
      throw error
    } finally {
      span.end()
    }
  })
}

/**
 * Um span de cliente que cobre um stream inteiro (a chamada ao LLM): abre no primeiro `next()`, e
 * fecha quando o stream termina, falha ou é abandonado (`return()` do consumidor, cancelamento).
 */
export async function* tracedIterable<T>(
  name: string,
  attributes: Attributes,
  iterate: (span: Span) => AsyncIterable<T>,
): AsyncGenerator<T> {
  const span = tracer().startSpan(name, { kind: SpanKind.CLIENT, attributes })
  try {
    yield* iterate(span)
  } catch (error) {
    markFailed(span, error)
    throw error
  } finally {
    span.end()
  }
}

/** O span ativo grava? (Sem SDK, ou numa requisição descartada pelo sampler, não.) */
export function hasRecordingSpan(): boolean {
  return trace.getSpan(context.active())?.isRecording() === true
}

/** Abre um span de cliente filho do contexto atual (para quem precisa fechá-lo à mão). */
export function startClientSpan(name: string, attributes: Attributes): Span {
  return tracer().startSpan(name, { kind: SpanKind.CLIENT, attributes })
}
