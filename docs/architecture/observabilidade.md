# Observabilidade

Chega na F6. Três destinos: Grafana Cloud (traces, logs, métricas e alertas), Langfuse Cloud
(traces de LLM e custo por consulta) e PostHog (produto e, se atender, erros). Nada depende de
timer de exportação: a instância da Vercel pausa entre requisições.

## OTel (linha 2.x)

- SDK Node padrão, sem `@vercel/otel` e sem coletor. Na Vercel não há `node --import`, então
  `server.ts` inicializa o SDK antes de importar dinamicamente o resto da app. Fastify pelo
  `@fastify/otel` (plugin); spans de `pg` e das chamadas aos provedores criados à mão nos adapters
  (`withSpan`), porque o bundle não garante a auto-instrumentação por hook de módulo.
- **Resource:** `service.name=teko-api`, `service.version`, `deployment.environment.name`,
  `vcs.ref.head.revision`, `process.runtime.version` (o minor real da Vercel) e `cloud.region`.
- **Processors:** `BatchSpanProcessor` com exporter OTLP/HTTP direto ao endpoint da stack Grafana
  Cloud, e `LangfuseSpanProcessor` (abaixo). Os spans de LLM chegam aos dois com o mesmo `trace_id`.
- **Flush:** ao fim de cada request de API, `BackgroundTasks` (`waitUntil`) roda o `forceFlush` de
  traces e logs com teto de 500 ms; métricas em temporalidade delta no mesmo flush, no máximo uma
  vez por minuto por instância. Telemetria de uma invocação que estoura o prazo pode se perder.
- **Sampler:** `AlwaysOnSampler` descartando `/healthz`; o `trace_id` do `traceparent` do navegador
  é reaproveitado, mas a flag `sampled` é ignorada.
- **Logs:** pino em JSON no stdout só para depuração imediata (logs de runtime da Vercel: 1 h);
  logs duráveis pelo exporter OTLP de logs para o Loki, com `env`, `service` e `level`.
- **Correlação:** o navegador propaga `traceparent` para `/api`; a API devolve `x-trace-id`, que a
  UI mostra como "ID de suporte"; o `trace_id` vai como propriedade ao PostHog.

## Langfuse Cloud Hobby (EU)

- Projetos `teko-prod` e `teko-staging`; `LANGFUSE_BASE_URL`, `LANGFUSE_TRACING_ENVIRONMENT`,
  `LANGFUSE_RELEASE=<gitSha>`, `LLM_TRACING_BACKEND=langfuse|off`.
- Observations criadas com `@langfuse/tracing`. O processor exporta só spans do SDK e `gen_ai` dos
  traces amostrados; o `mask` aplica o `PiiRedactor`. O `TraceSampler` decide no início do
  `rag-query` (hash do `questionId`), independente da flag do navegador.
- **Trace (3 a 5 units):** `rag-query` (usuário com hash, pergunta redigida, data e
  `ReferenceSource`, `corpus_version`, `prompt_version`, cache, cobertura); span `retrieval`
  (candidatos por canal, top-k, RRF, reranker, `retrievalMode`); uma generation `answer` por
  provedor tentado, com `usageDetails`, `costDetails` a preço de tabela (`pricing.json`),
  `metadata.billed_usd=0` e TTFT; cache hit gera só o trace.
- Modelos cadastrados em Settings → Models com os preços do `pricing.json`, pelo `ops.yml`. O
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
