# Observabilidade

Chega na F6. Três destinos: Grafana Cloud (traces, logs, métricas e alertas), Langfuse Cloud
(traces de LLM e custo por consulta) e PostHog (produto e, se atender, erros). Nada depende de
timer de exportação: a instância da Vercel pausa entre requisições.

## OTel (linha 2.x)

- SDK Node padrão (`@opentelemetry/sdk-trace-node`, `sdk-metrics`, `sdk-logs` e os exporters
  OTLP/HTTP), sem `@vercel/otel`, sem `@opentelemetry/sdk-node` e sem coletor. Na Vercel não há
  `node --import`, então `server.ts` chama `startInstrumentation` (`src/instrumentation.ts`, sobre
  `adapters/out/telemetry/sdk.ts`) antes de importar dinamicamente a raiz de composição. Fastify
  pelo `@fastify/otel` (plugin explícito, span `request` com `http.route`); spans de `pg` (o `query`
  de cada cliente do pool, `pg-tracing.ts`), do LLM (`chat <modelo>`, com `gen_ai.*` e o uso de
  tokens), dos embeddings e do reranker do Workers AI criados à mão nos adapters (`withSpan` e
  `tracedIterable` de `adapters/out/telemetry/tracing.ts`), porque o bundle não garante a
  auto-instrumentação por hook de módulo. Os spans levam o tipo do erro (`error.type`), nunca a
  mensagem (pode repetir valores do prompt ou da consulta).
- **Resource:** `service.name=teko-api`, `service.version`, `deployment.environment.name`,
  `vcs.ref.head.revision`, `process.runtime.name` e `process.runtime.version` (o minor real da
  Vercel), `cloud.region` (`VERCEL_REGION`, só na Vercel) e `service.instance.id` (um UUID por
  processo, que separa as séries de instâncias simultâneas).
- **Processors:** `BatchSpanProcessor` com exporter OTLP/HTTP direto ao endpoint da stack Grafana
  Cloud e, no mesmo provider, os de `additionalSpanProcessors` (`src/instrumentation.ts`): o
  `LangfuseSpanProcessor` (abaixo) entra ali. Os spans de LLM chegam aos dois com o mesmo `trace_id`.
- **Flush:** ao fim de cada request de `/api` (menos `/api/healthz`), o hook `onResponse`
  (`adapters/in/http/plugins/telemetry.ts`) põe o flush em `BackgroundTasks` (`waitUntil`) com teto
  de 500 ms: `forceFlush` de traces e logs e, no máximo uma vez por minuto por instância, das
  métricas, por um leitor sem timer (`OnDemandMetricReader`). Falha de
  exportação é engolida (não vira log, que viraria outra exportação). No SIGTERM, o encerramento
  gracioso exporta o que sobrou (métricas inclusive) com o teto das tarefas pós-resposta. Telemetria
  de uma invocação que estoura o prazo pode se perder.
- **Sampler** (`TekoSampler`): sempre amostra, menos `/healthz` e `/api/healthz` (por `url.path` ou
  `http.route`); com pai remoto (o `traceparent` do navegador), o `trace_id` é reaproveitado e a
  flag `sampled` é ignorada; com pai local, segue a decisão dele (os filhos de um `/healthz` também
  saem descartados).
- **Logs:** pino em JSON no stdout só para depuração imediata (logs de runtime da Vercel: 1 h); a
  mesma linha, já com o `redact`, vai ao `LogSink` do OTel (`log-sink.ts`) e ao Loki pelo exporter
  OTLP de logs, com `env` e `service` (atributos e resource), `level` (`severity_text`) e o
  `trace_id`/`span_id` do span ativo (o `mixin` do logger põe os dois em toda linha, também no
  stdout). Com `LOG_PRETTY=true` (só dev), os logs ficam só no terminal.
- **Correlação:** o web gera um `traceparent` W3C por requisição a `/api` (`apps/web/src/lib/api/
  trace.ts`, no cliente gerado e no `fetch` do stream; sem SDK no navegador, flag `sampled` em 0);
  a API devolve `x-trace-id` em toda resposta, igual ao `traceId` dos Problem Details e do `finish`
  do stream, e a UI o mostra como "ID de suporte" nas mensagens de erro; o `trace_id` vai como
  propriedade ao PostHog. Sem o SDK (testes), o `x-trace-id` sai do `traceparent` ou de um id
  aleatório no mesmo formato.
- **Configuração:** `OTEL_EXPORTER_OTLP_ENDPOINT` (base OTLP/HTTP; os sinais vão em `/v1/traces`,
  `/v1/metrics` e `/v1/logs`) e `OTEL_EXPORTER_OTLP_HEADERS` (formato da especificação, `chave=valor`
  com URL encoding; no Grafana Cloud, `Authorization=Basic%20<base64 de instância:token>`), as duas
  Sensitive na Vercel. Staging e produção exigem https; sem o endpoint (CI, testes, dev sem a stack),
  nada é exportado, a porta de métricas é no-op e o boot de staging ou produção avisa no log.
- **Temporalidade das métricas:** cumulativa (decisão do mantenedor em 2026-11-16, no lugar do delta
  do desenho original). Cada exportação leva o total da instância desde que ela subiu, numa série
  própria por `service.instance.id`; o `rate()`/`increase()` trata o recomeço do zero de uma
  instância nova. O Mimir recusa métricas delta enquanto a ingestão nativa de delta
  (`-distributor.otel-native-delta-ingestion`, experimental) estiver desligada, e o Prometheus do
  `otel-lgtm` também: na prova local, em delta só o gauge chegou; em cumulativo, tudo.
  `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta` fica como opção para um destino que
  aceite delta.
- **Tracing da Vercel:** os spans de fetch da Vercel param quando o pacote lista
  `@opentelemetry/api` ou `@opentelemetry/sdk-trace-node`, e os de framework e custom só existem com
  `@vercel/otel`, que o Tekó não usa; sobram os de infraestrutura da própria Vercel, que o
  `vercel-usage` (F7) mede contra a cota de 1M.
- **Dev local:** profile `otel` em `infra/local/compose.yaml` (`grafana/otel-lgtm`, Grafana em
  `http://localhost:3300`, OTLP/HTTP em `127.0.0.1:4318`); na API,
  `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`.

### Métricas (contrato com os painéis e alertas)

Definidas só em `adapters/out/telemetry/metrics.ts`, atrás da porta `Telemetry`
(`application/ports/telemetry.ts`); a aplicação não importa OTel. O ambiente vem do resource
(`deployment_environment_name` no Mimir).

| Instrumento OTel                 | Tipo           | Atributos                                                                                                        | Prometheus (Mimir)                       | Emitido em                                                |
| -------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------- |
| `http.server.request.duration`   | histograma (s) | `http.request.method`, `http.route` (sem rota no 404), `http.response.status_code`                               | `http_server_request_duration_seconds_*` | hook `onResponse` (toda requisição)                       |
| `teko.rag.answers`               | counter        | `outcome` (`answered\|refused\|failed\|aborted`), `refusal_reason`, `retrieval_mode`, `cached`, `corpus_version` | `teko_rag_answers_total`                 | `AskQuestion` (cache, fora da cobertura) e `StreamAnswer` |
| `teko.rag.citations_invalidated` | counter        | `corpus_version`                                                                                                 | `teko_rag_citations_invalidated_total`   | pipeline da resposta (citação a fonte inexistente)        |
| `teko.rag.insufficient_sentinel` | counter        | `corpus_version`                                                                                                 | `teko_rag_insufficient_sentinel_total`   | pipeline da resposta                                      |
| `teko.rag.reranker_score`        | histograma     | `rank` (`top1\|top12`)                                                                                           | `teko_rag_reranker_score_*`              | `HybridSearch` (só quando o reranker reordenou)           |
| `teko.llm.ttft`                  | histograma (s) | `provider`, `model`                                                                                              | `teko_llm_ttft_seconds_*`                | `StreamAnswer`                                            |
| `teko.llm.tokens`                | counter        | `provider`, `model`, `type` (`input\|output`)                                                                    | `teko_llm_tokens_total`                  | `StreamAnswer`                                            |
| `teko.llm.shadow_cost`           | counter (USD)  | `provider`, `model`                                                                                              | `teko_llm_shadow_cost_usd_total`         | `StreamAnswer` (`services/pricing.ts`)                    |
| `teko.llm.provider_errors`       | counter        | `provider`, `status` (`429\|5xx\|4xx`; `5xx` inclui rede e timeout)                                              | `teko_llm_provider_errors_total`         | `ProviderRouter`                                          |
| `teko.llm.provider_fallback`     | counter        | `from`, `to` (modelos)                                                                                           | `teko_llm_provider_fallback_total`       | `ProviderRouter` (antes do primeiro token)                |
| `teko.quota.used_ratio`          | gauge          | `scope` (`global_questions\|global_stream_seconds\|global_neurons`, a linha `global` de `usage_daily`)           | `teko_quota_used_ratio`                  | `QuotaGuard`, no snapshot da decisão                      |

## Langfuse Cloud Hobby (EU)

- Projetos `teko-prod` e `teko-staging`; `LANGFUSE_BASE_URL`, `LANGFUSE_TRACING_ENVIRONMENT`,
  `LANGFUSE_RELEASE=<gitSha>`, `LLM_TRACING_BACKEND=langfuse|off`.
- Observations criadas com `@langfuse/tracing`. O processor exporta só spans do SDK e `gen_ai` dos
  traces amostrados; o `mask` aplica o `PiiRedactor`. O `TraceSampler` decide no início do
  `rag-query` (hash do `questionId`), independente da flag do navegador.
- **Trace (3 a 5 units):** `rag-query` (usuário com hash, pergunta redigida, data e
  `ReferenceSource`, `corpus_version`, `prompt_version`, cache, cobertura); span `retrieval`
  (candidatos por canal, top-k, RRF, reranker, `retrievalMode`); uma generation `answer` por
  provedor tentado, com `usageDetails`, `costDetails` a preço de tabela (`services/pricing.ts`),
  `metadata.billed_usd=0` e TTFT; cache hit gera só o trace.
- Modelos cadastrados em Settings → Models com os preços de `services/pricing.ts`, pelo `ops.yml`. O
  dashboard de custo do Langfuse é a visão oficial de custo por consulta; as não amostradas têm o
  custo em `app.questions.shadow_cost_usd`.
- **Amostragem:** prod 1,0 até a projeção mensal chegar a 35k units, depois 0,2; staging 0,1; CI
  off. A soma dos dois projetos fica abaixo de 45k.
- **Feedback:** `POST /questions/:id/feedback` grava no Postgres e, se o trace foi amostrado, cria
  o score `user_feedback`. 👎 entra na annotation queue (veja "Sinais de RAG").
- **Prompts:** a fonte de verdade é o repositório; a Prompt Management do Langfuse não é usada.
- **Dev local:** profile `langfuse` em `infra/local/compose.yaml`, portas só em `127.0.0.1`.

## Erros

- **PostHog Error Tracking** na F6, se cobrir o que o Sentry cobriria: source maps enviados no CI,
  agrupamento por release (`teko@X.Y.Z`; staging `teko@<sha7>`) e destino para os relatórios de
  CSP e Trusted Types. Se não atender, o Sentry fica (organização EU, só erros, projeto separado
  para CSP), decisão registrada na ADR da F6.
- Na API, os erros vão pela `ErrorReporterPort` no `setErrorHandler`, com scrubber de PII e flush
  em `BackgroundTasks` só quando houve erro.

## PostHog (produto)

Catálogo tipado em `packages/shared/src/analytics/events.ts`; o texto da pergunta **nunca** é
enviado.

| Evento                                           | Propriedades                                                 |
| ------------------------------------------------ | ------------------------------------------------------------ |
| `question_asked`                                 | `locale`, `reference_source`                                 |
| `reference_date_set`                             | `source`                                                     |
| `clarification_shown`                            |                                                              |
| `answer_completed`                               | `model_family`, `cached`, `retrieval_mode`, `latency_bucket` |
| `answer_refused`                                 | `reason`                                                     |
| `citation_opened`                                | `doc_type`, `version_is_current`                             |
| `diff_opened`                                    |                                                              |
| `answer_feedback`                                | `rating`, `reason`                                           |
| `quota_reached`                                  | `scope`                                                      |
| `provider_fallback`                              | `from`, `to`                                                 |
| `consent_updated`, `locale_changed`, `web_vital` |                                                              |

## Sinais de RAG em produção (ADR 0031)

Métricas emitidas pela API e acompanhadas no Grafana, por ambiente e `corpus_version`:

- taxa de recusa por motivo (`out_of_coverage`, `no_evidence`, `model_insufficient`,
  `citation_invalid`);
- fração de respostas `lexical_only` (embedding fora do ar);
- citações invalidadas pelo `CitationValidator`;
- distribuição do score do reranker no top-1 e no top-12;
- frequência do sentinel `INSUFICIENTE`.

**Laço de feedback:** 👎 → annotation queue do Langfuse → triagem mensal pelo mantenedor → casos
aprovados entram no golden `holdout` (com `source_quote` conferida).

## Grafana Cloud (as code em `infra/grafana/`)

- **Dashboards:** API RED; LLM (TTFT, tokens, custo-sombra, fallback); cotas (Gemini, Groq,
  neurons, Langfuse units, CU-h); Vercel Hobby (`teko_vercel_usage_ratio` por recurso); sinais de
  RAG.
- **Synthetic Monitoring** substitui UptimeRobot e Checkly: `/healthz` de `tekoia.vercel.app` e
  `tekoia-staging.vercel.app` (sem DB) e um check da landing de produção, com frequência dentro da
  cota gratuita.
- **Alertas por e-mail:** 5xx > 2% em 10 min; p95 de `POST /api/v1/questions` ou TTFT p95 > 3 s;
  429 por provedor > 20% em 15 min; `teko_quota_used_ratio` > 0,7; CU-h > 70% pró-rata; Langfuse
  projetado > 35k; `teko_vercel_usage_ratio` > 0,5 e > 0,75 (o kill switch entra em 0,85); 503
  `DEPLOYMENT_PAUSED` visto pelo Synthetic Monitoring; `teko_coverage_verified_age_days > 3`;
  achado do `prod-vuln-scan`; tokens da Vercel vencendo em até 30 dias; falha do
  `weekly-maintenance` ou do `vercel-usage`; taxa de recusa ou de `lexical_only` fora do normal.

## Runbooks (`docs/runbooks/`)

| Runbook                 | Situação | Conteúdo                                                                                                                                                   |
| ----------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `neon-roles.md`         | existe   | criação dos roles `teko_app` e `teko_watch` e das URLs por environment                                                                                     |
| `rollback-corpus.md`    | ADR 0031 | repromover um snapshot antigo como `corpus_version` nova                                                                                                   |
| `provider-outage.md`    | F6       | breaker e fallback; `LLM_KILL_SWITCH`; troca de modelos por env                                                                                            |
| `quota-exhausted.md`    | F6       | qual cota estourou; reduzir tetos e amostragens por env                                                                                                    |
| `neon-suspended.md`     | F6       | `LLM_KILL_SWITCH`; esperar o ciclo do Neon; contingência opcional com projeto novo e o corpus pelo snapshot                                                |
| `vercel-paused.md`      | F7       | diagnóstico; esperar os 30 dias e **retomar à mão** (`vercel project resume` ou a API `unpause`); corte para o Plano B Render; nunca Pro nem segunda conta |
| `vercel-deploy.md`      | F7       | fluxo do deploy `--prebuilt`, WAF, Deployment Protection, opt-out de Model Training                                                                        |
| `budget-kill-switch.md` | F7       | limiares 50/75/85/95%; `LLM_KILL_SWITCH` com redeploy; regra 1 do WAF                                                                                      |
| `release-rollback.md`   | F7       | `vercel rollback` + `promote`; redeploy do tarball do release com `gh attestation verify`                                                                  |
| `secret-rotation.md`    | F7       | tokens da Vercel (90 dias) e bypass; Sensitive + redeploy; chaves de LLM                                                                                   |
| `quotas.md`             | F6       | RPD reais lidos no AI Studio e no Groq                                                                                                                     |
