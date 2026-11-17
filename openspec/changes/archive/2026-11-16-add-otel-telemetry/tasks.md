# Tasks

## 1. Dependências

- [x] 1.1 `@opentelemetry/*` da linha 2.x e `@fastify/otel` 0.21.4 no catálogo, com data, licença e
  proveniência conferidas (adendo na ADR 0002); grupo e `ignore` de major no Dependabot conferidos

## 2. SDK na API

- [x] 2.1 `adapters/out/telemetry/sdk.ts`: resource, traces, métricas cumulativas sem timer, logs e flush
- [x] 2.2 `TekoSampler` (descarta `/healthz`; pai remoto sem a flag `sampled`)
- [x] 2.3 `src/instrumentation.ts` chamado por `server.ts` antes do `import()`; regra no
  dependency-cruiser; ponto de extensão `additionalSpanProcessors`
- [x] 2.4 Spans à mão: `pg`, LLM, embeddings e reranker (`withSpan`, `tracedIterable`)
- [x] 2.5 Logs: `mixin` com `trace_id`/`span_id` e `LogSink` OTLP
- [x] 2.6 Flush final no encerramento gracioso
- [x] 2.7 Env: `OTEL_EXPORTER_OTLP_ENDPOINT` e `OTEL_EXPORTER_OTLP_HEADERS`, https em staging e
  produção

## 3. HTTP e métricas

- [x] 3.1 Plugin HTTP: `@fastify/otel`, `x-trace-id`, `http.server.request.duration` e flush em
  `BackgroundTasks` (500 ms)
- [x] 3.2 Porta `Telemetry` e `adapters/out/telemetry/metrics.ts` com os nomes do contrato
- [x] 3.3 Emissão no `AskQuestion`, `StreamAnswer`, pipeline da resposta, `HybridSearch`,
  `ProviderRouter` e `QuotaGuard`

## 4. Web

- [x] 4.1 `traceparent` por requisição a `/api` (cliente gerado e stream)
- [x] 4.2 "ID de suporte" do `x-trace-id` no `ApiError`, no chat e nas telas de erro (i18n nos dois
  idiomas)

## 5. Dev local e docs

- [x] 5.1 Profile `otel` (`grafana/otel-lgtm`, portas em `127.0.0.1`) e o passo no `CONTRIBUTING.md`
- [x] 5.2 `observabilidade.md` (tabela de métricas), `backend.md`, `contas-e-cotas.md` e
  `infra/vercel/env.*.json`

## 6. Testes e gates

- [x] 6.1 Unitários: sampler, SDK (flush, métricas 1x/min, cumulativo e delta, shutdown, extensão), métricas com
  exporter em memória, log sink, `pg`, plugin HTTP (`x-trace-id`, flush), env, encerramento
- [x] 6.2 Unitários da aplicação para cada sinal emitido; web: `traceparent`, `ApiError` e
  `SupportId`
- [x] 6.3 `pnpm verify`, `pnpm verify:full`, mutação local e o build do `.vercel/output`
- [x] 6.4 Prova local com o profile `otel`: trace com o `trace_id` do `traceparent`, logs
  correlacionados e métricas
