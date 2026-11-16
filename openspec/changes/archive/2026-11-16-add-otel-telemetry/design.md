# Design

## Context

Arquitetura vigente em `docs/architecture/observabilidade.md` (seção OTel) e `backend.md`. A API é
uma Function da Vercel em Fluid compute: sem `node --import`, sem drains de log no Hobby, com a
instância congelada entre invocações e 500 ms de SIGTERM. O bundle do tsdown deixa as dependências
externas, mas não há garantia de que um hook de módulo (`require-in-the-middle`) pegue o `pg` e o
Fastify carregados pelo handler.

Documentação consultada no Context7 (IDs):

- `/open-telemetry/opentelemetry-js/v2.12.1`: `NodeTracerProvider` (config com `spanProcessors`,
  `sampler`, `register()`), `resourceFromAttributes`, `MetricReader` (`onForceFlush`, `collect`,
  `readers` no `MeterProvider`), exporters OTLP/HTTP (`url`, `headers`, `timeoutMillis`).
- `/fastify/otel`: `FastifyOtelInstrumentation`, `plugin()`, `registerOnInitialization`, o span
  `request` e a extração do `traceparent` quando não há span ativo.
- `/websites/vercel`: tracing da Vercel (spans de fetch param com `@opentelemetry/api` ou
  `@opentelemetry/sdk-trace-node` no pacote; spans de framework e custom só com `@vercel/otel`).
- `/grafana/mimir` e `/websites/grafana_grafana-cloud`: OTLP direto ao Grafana Cloud (endpoint e
  headers) e a ingestão de métricas delta (recusada sem `-distributor.otel-native-delta-ingestion`).
- `/grafana/docker-otel-lgtm`: imagem `grafana/otel-lgtm`, portas (Grafana 3000, OTLP/HTTP 4318) e
  pin por digest.

## Goals / Non-Goals

**Goals:** traces, métricas e logs da API no Grafana Cloud com o mesmo `trace_id` do navegador;
nada dependendo de timer de exportação; contrato de métricas fixo para os painéis e alertas; ponto de
extensão para o Langfuse.

**Non-Goals:** Langfuse (`add-llm-tracing-langfuse`), destino de erros (`add-error-tracking`),
PostHog (`add-product-analytics`), Grafana as code e Synthetic Monitoring (`add-uptime-monitoring`).

## Decisions

- **Pacotes base em vez do `@opentelemetry/sdk-node`.** O `sdk-node` arrasta exporters gRPC, proto,
  Zipkin e Prometheus e a auto-instrumentação; aqui só entram `sdk-trace-node`, `sdk-metrics`,
  `sdk-logs`, `resources`, `semantic-conventions`, os três exporters OTLP/HTTP e o `@fastify/otel`.
- **Linha 2 com `@fastify/otel` 0.21.4.** O `@fastify/otel` 1.x exige OTel 3 (`core` ^3). O
  0.223.2 ainda não tinha 7 dias. A `@opentelemetry/api` fica na 1.10.0 que a árvore já tinha, apesar
  do `< 1.10` declarado pelo SDK 2.12 (aviso de peer): uma 1.9.x só na API duplicava a variante de
  peer do `vitest` e quebrava o `@fast-check/vitest`. Registrado no adendo da ADR 0002.
- **`src/instrumentation.ts` como raiz própria.** É chamado por `server.ts` antes do `import()` da
  raiz de composição e é o único módulo, além dela e de `config/platform.ts`, que sobe adapters de
  saída (só os de `adapters/out/telemetry`); regra nova no dependency-cruiser. A aplicação e o
  domínio ficam proibidos de importar `@opentelemetry/*`.
- **Provider sempre registrado.** Mesmo sem endpoint, o `NodeTracerProvider` (sem processor de
  exportação) é registrado: o `traceparent` é extraído, os spans têm `trace_id` válido e o
  `x-trace-id` funciona igual no CI e no dev. Métricas e logs ficam no-op sem endpoint.
- **Sampler `TekoSampler`.** Não é `ParentBased`: com pai remoto ignora a flag (o navegador manda
  `sampled=0`, porque não grava nada), com pai local segue a decisão (filhos de um `/healthz`
  descartado não viram spans soltos). Descarta `/healthz` e `/api/healthz` por `url.path` ou
  `http.route`, os atributos que o `@fastify/otel` põe no início do span.
- **Leitor de métricas sem timer (`OnDemandMetricReader`).** Delta, coleta e exporta só no
  `forceFlush`; o flush por requisição chama no máximo 1x/min por instância; o `shutdown` exporta o
  resto. O `PeriodicExportingMetricReader` teria um timer que não dispara com a instância congelada.
- **Flush depois de uma volta do event loop.** O hook `onResponse` agenda `setImmediate` + flush em
  `BackgroundTasks` (500 ms), para levar também a linha "request completed" do pino. Falha de
  exportação é engolida: virar log geraria outra exportação a cada requisição com o Grafana fora.
- **Logs pela linha já serializada.** Um `pino.multistream` escreve no stdout e no `LogSink`, que
  faz o parse da linha (com o `redact` aplicado) e emite o log record com o contexto montado do
  `trace_id`/`span_id` da própria linha (o `mixin` do logger os põe). Assim nada que o `redact`
  remove chega ao Loki. Com `LOG_PRETTY` (só dev) não há `LogSink`.
- **`pg` pelo `query` de cada cliente do pool.** O evento `connect` do pool embrulha o `query` do
  cliente, que cobre o Drizzle (promise) e o próprio pool (callback); só há span com um span ativo
  gravando, então CLI e manutenção não abrem traces soltos. O texto vai truncado em 1.000
  caracteres; os parâmetros nunca.
- **Tracer pedido a cada span.** A `@opentelemetry/api` 1.10 tem builds ESM e CJS separados: o SDK
  (CJS) registra o provider no proxy do build CJS, e um `ProxyTracer` guardado no carregamento de um
  módulo ESM ficaria no-op para sempre. `withSpan` e os outros helpers chamam `trace.getTracer` na
  hora, que lê o provider global compartilhado (os testes de `pg` e `withSpan` pegaram o problema).
- **Erro no span só com o tipo.** `error.type` e o status; a mensagem não (erros do Postgres e dos
  provedores podem repetir valores). O erro completo e saneado é do destino de erros.
- **`x-trace-id`.** O `trace_id` do span da requisição; sem SDK, o do `traceparent`; sem os dois, um
  id aleatório de 32 hex. O mesmo valor vai no `traceId` dos Problem Details (antes era o request id)
  e no `finish` do stream.
- **Web sem SDK.** Um `traceparent` por requisição (interceptor do cliente gerado e o `fetch` do
  stream), `sampled=0`; o `ApiError` lê o `traceId` do corpo ou do `x-trace-id`; o transporte do chat
  guarda o `x-trace-id` do stream para o chunk `error`. A UI mostra o "ID de suporte" (componente
  `SupportId`) nos erros da API.
- **Escopos da cota.** `teko.quota.used_ratio` usa os três recursos da linha `global` de
  `usage_daily` (`global_questions`, `global_stream_seconds`, `global_neurons`); a cota por usuário
  não vira gauge (seria um valor por usuário, sem sentido num painel).

## Risks / Trade-offs

- **Delta pode não chegar ao Grafana Cloud.** O Mimir recusa métricas delta sem a ingestão nativa de
  delta (experimental), e o Prometheus do `otel-lgtm` também: na prova local, em delta só o gauge
  apareceu; em cumulativo, tudo. O padrão segue o desenho (delta), e
  `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative` liga a alternativa (com
  `service.instance.id` no resource, uma série por instância). A troca do padrão em staging e
  produção fica para o mantenedor decidir, porque contraria a arquitetura.

- Telemetria de uma invocação que estoura o prazo ou o teto de 500 ms se perde (aceito na
  arquitetura). O exporter tem teto de 1 s por requisição: um envio que continua depois do
  `waitUntil` termina na próxima vez que a instância acordar.
- O parse da linha do pino custa um `JSON.parse` por log; o volume da API é baixo.
- Os spans de infraestrutura da própria Vercel continuam; o `vercel-usage` (F7) mede a cota.
