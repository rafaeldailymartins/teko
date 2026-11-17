# Tasks

## 1. Dependências

- [x] 1.1 `@langfuse/otel` e `@langfuse/tracing` 6.1.1 no catálogo (MIT, proveniência, mais de 7
  dias, peers na linha 2 do OTel); `@langfuse/client` recusado (`mustache` sem proveniência);
  adendo na ADR 0002

## 2. Processor e configuração

- [x] 2.1 Env (`LANGFUSE_*`, `LLM_TRACING_BACKEND`, taxas e corte) com `langfuseSettings`, https em
  staging e produção, chaves aos pares, aviso no boot sem chaves
- [x] 2.2 `createLangfuseSpanProcessor` em `additionalSpanProcessors`: só spans do SDK, `mask` com o
  `PiiRedactor`, lote, sem mídia
- [x] 2.3 `infra/vercel/env.*.json`, `infra/planb-render/render.yaml` e `apps/api/.env.example`

## 3. Amostragem e trace

- [x] 3.1 `TraceSampler` (FNV-1a do `questionId`, projeção do mês, corte, cache de 10 min) e
  `QueryTracer` (units, falhas isoladas)
- [x] 3.2 Porta `LlmTracingPort` e adapter com `@langfuse/tracing`: raiz `rag-query`, `retrieval` e
  generations com pai explícito, atributos de trace na raiz, usuário por hash
- [x] 3.3 `ProviderRouter` com `onFailedAttempt` e `attemptStartedAtMs`; helper de generations para
  a resposta e a reescrita (uma por provedor tentado, custo de tabela, TTFT, `billed_usd=0`)
- [x] 3.4 `AskQuestion` (cache e cobertura só com a raiz) e `StreamAnswer` (trace iniciado no
  contexto da requisição, fechado em todos os desfechos)
- [x] 3.5 `langfuse_trace_id` e units no `finish`, no `recordTrace` e no feedback;
  `langfuseUnitsSince` para a projeção; `shadow_cost_usd` coberto em todos os desfechos

## 4. Feedback e apagamento

- [x] 4.1 Score `user_feedback` e annotation queue do 👎 pela API pública, em `BackgroundTasks`
- [x] 4.2 `DeleteMyData` apaga os traces do usuário pelo hash

## 5. ops.yml

- [x] 5.1 `scripts/langfuse-ops.ts`: modelos por `pricingTiers`, score config, annotation queue e
  `teko_langfuse_units_projected` pela Metrics API v2
- [x] 5.2 Job `langfuse` no `ops.yml` (environment `ops`, harden-runner com os hosts exatos) e
  invariantes no `ci-config.test.sh`

## 6. Testes, prova e documentação

- [x] 6.1 Unitários: sampler, máscara, adapter com processor em memória, API pública com `fetch`
  falso, custo, feedback, generations por provedor, todos os desfechos do stream e o script do job
- [x] 6.2 Integração: `trace_id`, units e `shadow_cost_usd` em resposta, cache e recusa; feedback
  com score e falha do Langfuse
- [x] 6.3 Prova local (profile `langfuse`, LLM fake, taxa 1,0): 100 perguntas, 100 traces completos
  com o mesmo `trace_id` do `x-trace-id`; feedback, annotation queue, job do `ops.yml` e apagamento
- [x] 6.4 `observabilidade.md`, `backend.md`, `contas-e-cotas.md`, `quota-exhausted.md`,
  `CONTRIBUTING.md`, `infra/grafana/README.md` e a ADR 0012
