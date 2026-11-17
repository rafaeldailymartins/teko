# Proposal

## Why

A F6 liga a observabilidade. Sem ela, a API na Vercel Hobby só tem os logs de runtime de 1 h, sem
traces, sem métricas e sem um jeito de ligar um erro na tela do usuário ao que aconteceu no servidor.
O roteiro pede OTel 2.x com OTLP direto ao Grafana Cloud, flush por `BackgroundTasks` (a instância
pausa entre requisições) e os sinais de RAG da ADR 0031. Esta é a primeira mudança da F6; as do
Langfuse, do Error Tracking, do analytics e do uptime vêm sobre ela.

## What Changes

- **SDK do OTel na API** (`src/instrumentation.ts` e `adapters/out/telemetry/`), iniciado por
  `server.ts` antes do `import()` da raiz de composição: traces (`BatchSpanProcessor` + OTLP/HTTP),
  métricas (cumulativas, leitor sem timer) e logs (pino → OTLP), resource com serviço, versão, ambiente,
  commit, runtime e região. Sem `@vercel/otel` e sem coletor.
- **Sampler próprio:** sempre amostra, menos `/healthz`; reaproveita o `trace_id` do `traceparent`
  do navegador e ignora a flag `sampled` dele.
- **Spans à mão** de `pg`, do LLM, dos embeddings e do reranker (`withSpan`, `tracedIterable`); o
  Fastify pelo plugin `@fastify/otel`.
- **Flush por requisição** em `BackgroundTasks` com teto de 500 ms; métricas no máximo 1x/min por
  instância; flush final no SIGTERM.
- **Métricas de RAG e de LLM** com nomes fixos, atrás da porta `Telemetry` (a aplicação não importa
  OTel), emitidas no `AskQuestion`, no `StreamAnswer`, no pipeline da resposta, no `HybridSearch`, no
  `ProviderRouter` e no `QuotaGuard`.
- **Correlação:** `x-trace-id` em toda resposta da API (igual ao `traceId` dos Problem Details); o
  web manda um `traceparent` por requisição a `/api` e mostra o "ID de suporte" nos erros.
- **Env:** `OTEL_EXPORTER_OTLP_ENDPOINT` e `OTEL_EXPORTER_OTLP_HEADERS` (Sensitive na Vercel); sem
  endpoint, nada é exportado.
- **Dev local:** profile `otel` (`grafana/otel-lgtm`) no `infra/local/compose.yaml`.
- Ponto de extensão para o `LangfuseSpanProcessor` (`additionalSpanProcessors`).

## Capabilities

### New Capabilities

- `telemetry`: SDK do OTel da API, sampler, flush, logs duráveis e o contrato de métricas.

### Modified Capabilities

- `http-api`: `x-trace-id` em toda resposta, com o mesmo valor do `traceId` dos Problem Details.
- `web-data`: `traceparent` por requisição a `/api`; o "ID de suporte" do `ApiError` também vem do
  `x-trace-id`.
- `local-dev-environment`: profile `otel` com Grafana, Tempo, Loki e Mimir locais.

## Impact

- `apps/api`: `server.ts`, `instrumentation.ts`, `composition-root.ts`, `graceful-shutdown.ts`,
  `config/env.ts`, `build-app.ts`, `adapters/out/telemetry/*`, `adapters/in/http/plugins/telemetry.ts`,
  os adapters de `pg`, LLM e Workers AI, a porta `application/ports/telemetry.ts` e os casos de uso
  que emitem métricas; regra nova no `.dependency-cruiser.cjs`.
- `apps/web`: `lib/api/trace.ts`, `client.ts`, `errors.ts`, `chat-transport.ts`, `lib/chat/failure.ts`,
  o componente `SupportId` e as telas que mostram erro da API; `common.supportId` nos dois catálogos.
- Dependências novas (catálogo): `@opentelemetry/*` da linha 2.x e `@fastify/otel` 0.21.4, todas com
  proveniência (adendo na ADR 0002).
- Docs: `observabilidade.md` (tabela de métricas), `backend.md`, `contas-e-cotas.md`,
  `CONTRIBUTING.md`; `infra/local/compose.yaml` e `infra/vercel/env.*.json`.
- Segredos a cadastrar pelo mantenedor: `OTEL_EXPORTER_OTLP_ENDPOINT` e `OTEL_EXPORTER_OTLP_HEADERS`
  (Sensitive, nos projetos `tekoia` e `tekoia-staging`).
