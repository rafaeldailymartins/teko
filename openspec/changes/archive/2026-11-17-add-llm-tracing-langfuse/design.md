# Design

## Context

Arquitetura vigente em `docs/architecture/observabilidade.md` ("Langfuse Cloud Hobby (EU)") e
`backend.md`. O OTel 2.x da API (`add-otel-telemetry`) registra um `NodeTracerProvider` global com o
`TekoSampler` (amostra tudo, menos o health check) e chama `forceFlush` de todos os processors no
flush por requisição. O Langfuse Cloud roda a v4 (modelo de eventos): a ingestão é OTLP
(`/api/public/otel/v1/traces`) e a leitura em tempo real é a API v2 de observations.

Documentação consultada no Context7 (IDs):

- `/langfuse/langfuse-js`: `LangfuseSpanProcessor` (parâmetros `mask`, `shouldExportSpan`,
  `exportMode`, `environment`, `release`, `mediaUploadEnabled`, `timeout`, `exporter`),
  `isLangfuseSpan`/`isDefaultExportSpan`, `startObservation` (`asType`, `startTime`,
  `parentSpanContext`), atributos `LangfuseGenerationAttributes` (`usageDetails`, `costDetails`,
  `completionStartTime`), `propagateAttributes` e as chaves `LangfuseOtelSpanAttributes`
  (`langfuse.trace.*`, `user.id`), além da marcação de raiz da aplicação (`is_app_root`).
- `/langfuse/langfuse-docs`: `POST /api/public/scores` (id como chave de idempotência, BOOLEAN),
  annotation queues (`/api/public/annotation-queues` e `/items`, score configs), apagamento
  (`DELETE /api/public/traces`, até 1.000 ids, assíncrono; busca por `userId` na v2 de
  observations), Models API (`/api/public/models`, `pricingTiers`) e Metrics API v2
  (`/api/public/v2/metrics`, views `observations` e `scores-*`, filtro `isRootObservation`).
- OpenAPI do Langfuse 4.78.0 local (`/generated/api/openapi.yml`) para os esquemas exatos de
  `CreateModelRequest`, `CreateScoreRequest`, `CreateAnnotationQueueRequest` e dos campos da v2 de
  observations.

## Goals / Non-Goals

**Goals:** traces de LLM amostrados com o mesmo `trace_id` do OTel; custo por consulta a preço de
tabela; units sob controle (corte em 35k projetadas); feedback e annotation queue; apagamento com a
conta; nada no CI e nos testes sem chaves.

**Non-Goals:** Prompt Management do Langfuse; avaliação automática no Langfuse (F8); PostHog Error
Tracking (`add-error-tracking`); dashboards do Langfuse as code.

## Decisions

- **Só os spans do SDK do Langfuse vão ao Langfuse.** O padrão do SDK (`isDefaultExportSpan`) também
  exporta os spans `gen_ai.*`; aqui o `chat <modelo>` do adapter de LLM fica só no Grafana. A
  generation `answer` (e `rewrite`) já carrega modelo, uso, custo e TTFT: exportar os dois duplicaria
  tokens e custo e gastaria 1 ou 2 units a mais por pergunta. Desvio do texto anterior da arquitetura
  ("spans do SDK e `gen_ai`"), registrado na ADR 0012 e em `observabilidade.md`.
- **Observations criadas com pai explícito.** A raiz `rag-query` nasce no contexto da requisição (no
  `POST` ou logo depois do claim do stream, antes de devolver o iterável), então é filha do span
  `request` e tem o mesmo `trace_id`; as filhas recebem `parentSpanContext` da raiz, porque o
  gerador do stream roda fora do contexto assíncrono dela. Os atributos de trace (`user.id`,
  `langfuse.trace.name`, tags e metadata) vão direto na raiz pelo mesmo motivo (o
  `propagateAttributes` só alcançaria spans criados dentro do callback). O processor marca a raiz
  como raiz da aplicação, mesmo com o `request` filtrado.
- **Amostragem na aplicação, não no OTel.** O `TekoSampler` continua amostrando tudo para o Grafana;
  o `TraceSampler` decide se o caso de uso cria observations. FNV-1a de 32 bits sobre o `questionId`
  (determinístico, sem cripto, puro). A projeção usa o `usage_daily.langfuse_units` do próprio
  banco, relida a cada 10 min por instância (as perguntas simultâneas dividem a leitura); falha vale
  como corte atingido. Sem chance de corte (taxas iguais), nem lê o banco.
- **Units contadas pela aplicação:** 1 pelo trace mais 1 por observation (raiz, `retrieval`, cada
  generation) e 1 por score. O stream grava o `langfuse_trace_id` e soma as units na transação da
  resposta (só na linha `global`); o `POST` (cache e cobertura) usa uma instrução só
  (`UPDATE … RETURNING` + `INSERT … ON CONFLICT`) em tarefa pós-resposta, porque o id da pergunta só
  existe depois do `INSERT`; o feedback soma o score na mesma instrução do `INSERT` do polegar.
- **Uma generation por provedor tentado.** O `ProviderRouter` ganhou o `onFailedAttempt` (falha antes
  do primeiro token, com o tipo e os instantes) e o `attemptStartedAtMs` no `start`. O helper
  `services/generation-trace.ts` serve à resposta e à reescrita. A generation fecha no `finally`,
  porque a desconexão chega como `return()` do gerador, não como exceção.
- **Custo:** `costBreakdown` de `services/pricing.ts` (entrada, saída e total, 6 casas), a mesma
  tabela do `shadow_cost_usd`; a tabela passou a ser exportada (`MODEL_PRICES`, `PRICING_DATE`) para
  o job do `ops.yml`. `metadata.billed_usd=0` em toda generation. O `shadow_cost_usd` já era
  `NOT NULL DEFAULT 0` e gravado em todo `finish`; os testes passaram a cobrir todos os desfechos.
- **API pública por `fetch`** (score, annotation queue, apagamento): o `@langfuse/client` traz o
  `mustache` 4.2.0, sem proveniência. Score com id `<questionId>-user_feedback` (trocar o polegar no
  mesmo dia substitui) e `environment` dos traces; a queue é achada pelo nome uma vez por instância.
  Tudo em `BackgroundTasks` com teto de 2 s, e cada chamada com teto de 1,5 s.
- **Apagamento:** a v2 de observations filtra por `userId` (o hash), com cursor; os ids vão ao
  `DELETE /api/public/traces` em lotes de 1.000. Prova local: 107 traces de um usuário sumiram em
  cerca de 10 s.
- **Job `langfuse` do `ops.yml`** (`scripts/langfuse-ops.ts`): modelos por `pricingTiers` (as
  `inputPrice`/`outputPrice` estão obsoletas na API), recriados quando o preço ou o padrão muda;
  score config BOOLEAN e annotation queue com ela. `teko_langfuse_units_projected` pela Metrics API
  v2 (observations + raízes + scores do mês UTC, nos dois projetos), não pelo `usage_daily`: a cota
  é da organização, o Langfuse conta o que a API não conta e a leitura não acorda o Neon nem exige
  credencial de banco no `ops`. `http` só aceito em `localhost` (a prova local).
- **Versões:** 6.1.1 (2026-11-03, mais de 7 dias), peers `@opentelemetry/core` e `sdk-trace-base`
  `^2.0.1` e exporter `<0.300`, resolvidos nas mesmas 2.12.1 e 0.223.1 do catálogo. A linha 3 do OTel
  continua bloqueada no Dependabot; o grupo `langfuse` já existia.

## Risks / Trade-offs

- A projeção da API (só o ambiente) e a do job (a organização) divergem; o alerta usa a do job.
- Um trace iniciado e nunca iterado (o cliente fecha antes do primeiro chunk) não é exportado;
  as units já contadas ficam um pouco acima do real.
- Langfuse fora do ar: a exportação falha em silêncio no flush (como a do Grafana), e o feedback
  fica no log de tarefa pós-resposta.

## Migration Plan

Sem migração de banco (`langfuse_trace_id` e `langfuse_units` já existiam). O mantenedor cria as
chaves; sem elas, staging e produção avisam no boot e seguem sem traces.
