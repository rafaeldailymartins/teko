# Observabilidade

Chega na F6. Três destinos: Grafana Cloud (traces, logs, métricas e alertas), Langfuse Cloud
(traces de LLM e custo por consulta) e PostHog (produto e Error Tracking, ADR 0037). Nada depende
de timer de exportação: a instância da Vercel pausa entre requisições.

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
  `LangfuseSpanProcessor` (abaixo) entra ali. As observations do Langfuse chegam aos dois com o mesmo
  `trace_id`; os spans `chat <modelo>` vão só ao Grafana.
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
  `vercel-usage` mede contra a cota de 1M (`tracing_spans`, quando o relatório de uso os traz).
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

Decisão na [ADR 0012](../adr/0012-langfuse-cloud.md). `@langfuse/otel` e `@langfuse/tracing` 6.1.1
sobre o mesmo `NodeTracerProvider` do OTel 2.x; o Langfuse Cloud roda a v4 (modelo de eventos).

- Projetos `teko-prod` e `teko-staging`. Env: `LANGFUSE_PUBLIC_KEY` e `LANGFUSE_SECRET_KEY`
  (Sensitive), `LANGFUSE_BASE_URL` (https em staging e produção), `LANGFUSE_TRACING_ENVIRONMENT`
  (padrão: o `APP_ENV`), `LANGFUSE_RELEASE` (padrão: o `GIT_SHA`) e `LLM_TRACING_BACKEND=langfuse|off`.
  Sem as duas chaves (CI, testes), nada é criado nem exportado; staging e produção sem chave avisam no
  boot. Configuração lida em `config/env.ts` (`langfuseSettings`).
- **Processor** (`adapters/out/telemetry/langfuse.ts`, devolvido por `additionalSpanProcessors`):
  exporta **só** os spans do SDK do Langfuse (escopo `langfuse-sdk`), que só existem nos traces
  amostrados. O `mask` passa o `redact` do `PiiRedactor` (`@teko/shared/pii`) em entrada, saída e
  metadata, como segunda barreira (a pergunta já chega redigida). Lote alcançado pelo flush por
  requisição (teto de 1 s por exportação), sem upload de mídia. **Desvio:** os spans `chat <modelo>`
  (`gen_ai.*`) do adapter de LLM ficam só no Grafana: a generation `generate-answer` já leva modelo, uso, custo
  e TTFT, e exportar os dois duplicaria tokens e custo no Langfuse e gastaria 1 ou 2 units a mais por
  pergunta.
- **`TraceSampler`** (`application/services/trace-sampler.ts`): decide no início do `answer-question`
  pelo FNV-1a do `questionId` (determinístico, independente da flag do navegador). A taxa do ambiente vale
  até a projeção linear do mês (`usage_daily.langfuse_units`, linha `global`, mês de São Paulo)
  chegar a `LANGFUSE_MONTHLY_UNITS_CUTOFF`; dali em diante, `LANGFUSE_SAMPLE_RATE_OVER_BUDGET` (nunca
  acima da taxa do ambiente). A projeção fica 10 min em memória por instância; falha na leitura vale
  como corte atingido. O `QueryTracer` conta as units de cada trace e engole falhas do adapter.
- **Trace `answer-question`** (o mesmo `trace_id` do OTel: a raiz é filha do span `request` e o
  Langfuse a marca como raiz da aplicação), montado pela página de boas práticas do Langfuse
  ("What does a good trace look like?", ADR 0012, adendo de 2026-11-17). Os nomes ficam em
  `langfuse-names.ts`, com verbo no início e estáveis (evaluators, dashboards e filtros os
  referenciam): trocar um deles exige refazer o que o referencia no Langfuse.
  - **Raiz `answer-question`:** entrada = a pergunta redigida; saída = a resposta em Markdown (sem
    saída quando não houve resposta). Metadata: data e `ReferenceSource`, famílias, locale,
    `corpus_version`, cache, desfecho, motivo da recusa, as citações usadas (rótulo, chave,
    documento, vigência e trecho, para um evaluator de fidelidade) e os ids das fontes não citadas;
    `version` = `PROMPT_VERSION`. Falha sai com `ERROR` e o código do erro, desconexão com
    `WARNING`, recusa com o motivo na mensagem de status.
  - **Atributos de correlação em toda observation** (o Langfuse v4 filtra observations sem juntar com
    o trace): usuário só por hash (`langfuseUserId`, sha256 truncado), `sessionId` = id da conversa
    (UUID interno, sem PII), tags (`llm` ou `cache` e o locale) e metadata curta do trace
    (`question_id`, data, origem, `corpus_version`, cache, locale). Vão direto nos spans, porque as
    filhas nascem fora do contexto assíncrono da raiz (o stream).
  - **Retriever `retrieve-context`:** entrada = a pergunta redigida, a consulta reescrita (quando
    houve), a data de referência e as famílias; saída = os dispositivos do top-k na ordem final (id
    do chunk, chave, rótulo, caminho de títulos, família, versão do documento, vigência, RRF e
    posição em cada braço), sem o texto, que vai inteiro no prompt da resposta. Metadata: modo,
    top-k, candidatos por canal, reranker, reescrita, famílias sem cobertura e recusa.
  - **Generations `generate-answer` e `rewrite-query`**, uma por provedor tentado (a que falhou antes
    do primeiro token vem com `level=ERROR` e o tipo da falha): entrada = as mensagens `system` e
    `user` no formato da OpenAI, como o modelo as recebeu; saída = a mensagem do assistente e, quando
    o modelo devolveu raciocínio, um item `reasoning` antes dela (a interface mostra como bloco
    "Thinking"); `version` = a versão do prompt; `usageDetails`, `costDetails` a preço de tabela
    (`services/pricing.ts`), `metadata.billed_usd=0`, `ttft_ms` e `completionStartTime`. O
    raciocínio chega no `finish` do adapter (não como evento), para o primeiro evento continuar sendo
    o primeiro texto e o fallback do router não mudar; o Gemini o devolve com `includeThoughts` (o
    resumo dos pensamentos) e o `gpt-oss` do Groq sem pedir.
  - Acerto do cache e recusa por cobertura (no `POST`) geram só a raiz. A conversa não entra no
    prompt (cada pergunta é independente), então a sessão agrupa os turnos sem repetir o histórico
    nas generations: serve para ver, na triagem de um 👎, as perguntas anteriores da conversa.
- **Units** (traces + observations + scores): resposta 4, com um fallback 5, recusa na busca 3,
  cache ou fora da cobertura 2, cada score 1. O stream grava o `langfuse_trace_id` e soma as units
  em `usage_daily` na mesma transação da resposta; o `POST` (cache e cobertura) e o feedback, em
  tarefa pós-resposta ou na mesma instrução do feedback.
- **Custo:** `app.questions.shadow_cost_usd` é gravado em 100% das linhas (0 sem LLM: recusas,
  cache, falhas e desconexões). Os modelos e preços de `services/pricing.ts` ficam em Settings →
  Models (tier padrão por token), aplicados pelo job `langfuse` do `ops.yml`. O dashboard de custo
  do Langfuse é a visão oficial de custo por consulta; as não amostradas têm o custo no Postgres.
- **Amostragem:** prod 1,0 até a projeção mensal chegar a 35k units, depois 0,2; staging 0,1; CI
  off (`infra/vercel/env.*.json`). A soma dos dois projetos fica abaixo de 45k.
- **Feedback:** `POST /questions/:id/feedback` grava no Postgres e, se a pergunta tem trace, cria
  em `BackgroundTasks` (teto de 2 s) o score `user_feedback` (BOOLEAN, id estável por pergunta, motivo
  no comentário). 👎 entra na annotation queue `teko-feedback-negativo` (veja "Sinais de RAG"). Falha
  do Langfuse nunca chega à resposta. Score, queue e apagamento usam a API pública por `fetch`
  (`adapters/out/telemetry/langfuse-api.ts`): o `@langfuse/client` depende do `mustache`, sem
  proveniência.
- **Apagamento:** `DeleteMyData` acha os traces do usuário pelo hash na API v2 de observations e os
  apaga em lotes (`DELETE /api/public/traces`, assíncrono no Langfuse; observations e scores saem
  junto).
- **Job `langfuse` do `ops.yml`** (`scripts/langfuse-ops.ts`, environment `ops`): modelos e preços,
  a score config `user_feedback` e a annotation queue nos dois projetos, e
  `teko_langfuse_units_projected` lido da Metrics API v2 (observations, raízes e scores do mês UTC
  dos dois projetos, projetado linearmente). A métrica vem do Langfuse, e não do `usage_daily`,
  porque a cota é da organização, conta o que a API não conta e a leitura não acorda o Neon.
- **Prompts:** a fonte de verdade é o repositório; a Prompt Management do Langfuse não é usada.
- **Dev local:** profile `langfuse` em `infra/local/compose.yaml` (imagens por digest, portas só em
  `127.0.0.1`); o `pnpm dev:secrets` grava a URL e as chaves do projeto `teko-dev` no
  `apps/api/.env`. O Langfuse v4 só lê pela API v2 de observations e pela v3 de scores (`GET
  /api/public/traces` responde 404 no modo de eventos).

## Erros

**PostHog Error Tracking** (UE; [ADR 0037](../adr/0037-erros-no-posthog-error-tracking.md)), no mesmo
projeto do analytics (o plano Free tem um só): staging e produção se separam pelo release
(`teko@<sha7>` e `teko@X.Y.Z`) e pelo `app_env`. Erros são legítimo interesse: não dependem do
consentimento e não gravam nada no navegador.

- **API:** a `ErrorReporterPort` (adapter do `posthog-node` em `adapters/out/error-reporting`) recebe
  do `setErrorHandler` só os erros inesperados (`internal`, 500); os 4xx e os 503 deliberados ficam
  de fora. Scrubber (`scrub.ts`): PII pelo `PiiRedactor`, credenciais de URL, mensagem cortada em 500
  caracteres, sem `cause`; o `before_send` tira as linhas de código-fonte dos frames. Propriedades:
  `trace_id`, `http_method`, `http_route` (a rota declarada), `http_status_code`, `error_code`
  (técnico), `release`, `app_env` e `service`; o `distinct_id` é o `trace_id` (técnico e aleatório),
  sem perfil de pessoa nem GeoIP. Envio imediato e flush em `BackgroundTasks` (500 ms) só quando
  houve erro. `POSTHOG_PROJECT_KEY` (Sensitive) liga; o host da UE é fixo no código.
- **Navegador:** handler de `error` e `unhandledrejection` no `instrumentation-client.ts`, os
  `ErrorBoundary` e as consultas e mutações que falham com 500 `internal` (com o `trace_id` do
  `ApiError`); o `posthog-js` entra por `import()` só no primeiro erro, numa instância própria
  (`teko_errors`) com `persistence: 'memory'`, sem perfil, só `$exception` e sem PII nem query nas
  URLs (`errorClientConfig` em `posthog-config.ts`). No máximo 10 erros por página.
  `NEXT_PUBLIC_POSTHOG_ERRORS_KEY` e `NEXT_PUBLIC_TEKO_RELEASE` no build.
- **Source maps:** `.map` do web (`productionBrowserSourceMaps`) e da API (tsdown), chunk ids
  injetados offline por `scripts/sourcemaps.ts inject` (stack de CI e deploy) e enviados por
  `scripts/sourcemaps.ts upload` no deploy da F7 (composite `.github/actions/posthog-sourcemaps`,
  com `POSTHOG_CLI_API_KEY` e `POSTHOG_CLI_PROJECT_ID`). O `posthog-cli` fica em
  `tools/posthog-cli`, com o binário conferido por sha256. Nenhum host serve os `.map`.
- **CSP e Trusted Types:** `report-uri` e `report-to posthog` ao endpoint `/report/?token=<chave>`
  da UE, com o header `Reporting-Endpoints` ([frontend](frontend.md#segurança-no-navegador)).
- **`source-watch`:** com mudança nas fontes, o evento `source_watch_changed` (famílias, tipos e o
  link do run), pela API de captura, com a chave do projeto do environment `staging`.

## PostHog (produto)

Catálogo tipado em `packages/shared/src/analytics/events.ts`; o texto da pergunta **nunca** é
enviado. Só com consentimento (`analytics: true`) e a chave pública no build (os erros têm instância
própria, acima); cliente em
`apps/web/src/lib/analytics/posthog-client.ts` (configuração e filtros em `posthog-config.ts`, hosts
em `posthog-hosts.ts`), sem `identify`, sem autocapture nem pageview. Cada evento passa pelo schema
estrito antes do `capture`. Retenção do PostHog Free: 1 ano.

| Evento                                                                           | Onde sai no web                                                         |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `question_asked`                                                                 | envio, resposta a um esclarecimento e "tentar de novo" (`chat-session`) |
| `reference_date_set`                                                             | chip de data e confirmação da data inferida                             |
| `clarification_shown`, `answer_completed`, `answer_refused`, `provider_fallback` | `onFinish` do `useChat` (`chat-events.ts`), sem abort nem erro          |
| `quota_reached`                                                                  | `ApiError` de cota com o escopo                                         |
| `citation_opened`                                                                | abertura do painel de citação (`chat-workspace`)                        |
| `diff_opened`                                                                    | cada `ProvisionDiff` montado (painel, dispositivo e comparação)         |
| `answer_feedback`                                                                | 👍/👎 gravado                                                           |
| `consent_updated`                                                                | escolha salva no banner ou nas preferências                             |
| `locale_changed`                                                                 | clique no menu de idioma                                                |
| `web_vital`                                                                      | `useReportWebVitals`, carregado só com o cliente ligado                 |

| Evento                                           | Propriedades                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| `question_asked`                                 | `locale`, `reference_source`                                             |
| `reference_date_set`                             | `source`                                                                 |
| `clarification_shown`                            | `trace_id`                                                               |
| `answer_completed`                               | `model_family`, `cached`, `retrieval_mode`, `latency_bucket`, `trace_id` |
| `answer_refused`                                 | `reason`, `trace_id`                                                     |
| `citation_opened`                                | `doc_type`, `version_is_current`                                         |
| `diff_opened`                                    |                                                                          |
| `answer_feedback`                                | `rating`, `reason`                                                       |
| `quota_reached`                                  | `scope`, `trace_id`                                                      |
| `provider_fallback`                              | `from`, `to`, `trace_id`                                                 |
| `consent_updated`, `locale_changed`, `web_vital` |                                                                          |

O `trace_id` (opcional, 32 hex) é o da resposta da API que gerou o evento: a mesma correlação do
Grafana, do Langfuse e do Error Tracking.

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

Formato compacto em JSON, validado offline nos testes dos scripts e aplicado pela API HTTP do
Grafana e do Synthetic Monitoring por `scripts/grafana-apply.ts`, no job `grafana` do `ops.yml`
(só em `main`, com dry-run no `workflow_dispatch`). Detalhes, segredos e a conta da cota em
[`infra/grafana/README.md`](../../infra/grafana/README.md).

- **Dashboards:** API RED; LLM (TTFT, tokens, custo-sombra, fallback, 429); cotas (Gemini, Groq,
  neurons, Langfuse units, CU-h, idade da cobertura, expiração de tokens); Vercel Hobby
  (`teko_vercel_usage_ratio` por recurso); sinais de RAG por ambiente e `corpus_version`.
- **Synthetic Monitoring** substitui UptimeRobot e Checkly: `/healthz` de `tekoia.vercel.app` e
  `tekoia-staging.vercel.app` a cada 5 min (sem DB) e a landing de produção (`/pt-BR/`) a cada
  15 min, da sonda de São Paulo: 20.160 das 100 mil execuções mensais do Free. O check da landing
  foi ligado no primeiro deploy do web de produção (F7, 2026-11-18).
- **Métricas do `ops.yml`** (job `quotas`, uma vez por dia, OTLP/HTTP com `service.name=teko-ops`):
  `teko_neon_compute_hours` e `teko_neon_cu_hours_ratio` por `project`,
  `teko_coverage_verified_age_days` por `family`, `teko_token_expiry_days` por `token` e
  `teko_ops_job_last_success_timestamp_seconds` por `ops_job`. O job `langfuse` (uma vez por dia)
  emite `teko_langfuse_units_projected` e o próprio sucesso. O `vercel-usage` (F7, uma vez por dia)
  emite `teko_vercel_usage_ratio{resource}` e o próprio sucesso; o `weekly-maintenance` (domingo)
  registra o sucesso pelo `weekly-maintenance-metrics`. Contrato da fonte que chega depois:
  `teko_prod_vuln_findings{severity}` (`prod-vuln-scan`, F7).
- **Alertas por e-mail:** 5xx > 2% em 10 min; p95 de `POST /api/v1/questions` ou TTFT p95 > 3 s;
  429 por provedor > 20% em 15 min; `teko_quota_used_ratio` > 0,7; CU-h > 70% pró-rata; Langfuse
  projetado > 35k; `teko_vercel_usage_ratio` > 0,5 e > 0,75 (o kill switch entra em 0,85); 503
  `DEPLOYMENT_PAUSED` visto pelo Synthetic Monitoring; check do Synthetic Monitoring falhando em
  todas as execuções de 20 min (timeout, erro de rede ou status fora de 200, inclusive o 500);
  `teko_coverage_verified_age_days > 3`;
  achado do `prod-vuln-scan`; tokens da Vercel vencendo em até 30 dias; falha do
  `weekly-maintenance` ou do `vercel-usage`; taxa de recusa ou de `lexical_only` fora do normal.

## Runbooks (`docs/runbooks/`)

| Runbook                 | Situação | Conteúdo                                                                                                                                                      |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `neon-roles.md`         | existe   | criação dos roles `teko_app` e `teko_watch` e das URLs por environment                                                                                        |
| `rollback-corpus.md`    | ADR 0031 | repromover um snapshot antigo como `corpus_version` nova                                                                                                      |
| `provider-outage.md`    | existe   | breaker e fallback; `LLM_KILL_SWITCH`; troca de modelos por env; 5xx, latência e embeddings fora do ar                                                        |
| `quota-exhausted.md`    | existe   | qual cota estourou; reduzir tetos e amostragens por env                                                                                                       |
| `neon-suspended.md`     | existe   | `LLM_KILL_SWITCH`; esperar o ciclo do Neon; contingência opcional com projeto novo e o corpus pelo snapshot                                                   |
| `ops-alerts.md`         | existe   | cobertura sem verificação, jobs do `ops.yml` sem sucesso, achado do `prod-vuln-scan`, check sintético falhando, recusa fora do normal                         |
| `vercel-paused.md`      | existe   | diagnóstico; esperar os 30 dias com aviso no README e no status e **retomar à mão** (`vercel project resume` ou a API `unpause`); nunca Pro nem segunda conta |
| `vercel-deploy.md`      | F7       | fluxo do deploy `--prebuilt`, WAF, Deployment Protection, opt-out de Model Training                                                                           |
| `budget-kill-switch.md` | existe   | limiares 50/75/85/95%; `LLM_KILL_SWITCH` com redeploy; regra 1 do WAF; exercício no staging e volta pelo dispatch do `ops.yml`                                |
| `release-rollback.md`   | F7       | `vercel rollback` + `promote`; redeploy do tarball do release com `gh attestation verify`                                                                     |
| `secret-rotation.md`    | F7       | tokens da Vercel (90 dias) e bypass; Sensitive + redeploy; chaves de LLM                                                                                      |
| `quotas.md`             | existe   | RPD reais lidos no AI Studio e no Groq                                                                                                                        |
