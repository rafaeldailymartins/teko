# Proposal

## Why

A F6 pede, além do OTel no Grafana, a visão por pergunta do caminho da resposta (busca, prompt,
modelo, tokens, TTFT e custo-sombra) e o laço do 👎 da ADR 0031. O roteiro prevê o Langfuse com
`TraceSampler`, preços de tabela e `costDetails`. O ponto de extensão (`additionalSpanProcessors`)
já existe desde o `add-otel-telemetry`; o texto de privacidade da F6 já descreve o Langfuse (UE,
usuário por hash, pergunta redigida, amostra, apagamento com a conta).

## What Changes

- **Dependências:** `@langfuse/otel` e `@langfuse/tracing` 6.1.1 (MIT, com proveniência, peers da
  linha 2 do OTel), adendo na ADR 0002. O `@langfuse/client` fica de fora (`mustache` sem
  proveniência): score, annotation queue e apagamento vão pela API pública por `fetch`.
- **Processor no mesmo provider do OTel** por `additionalSpanProcessors`, só com as chaves e
  `LLM_TRACING_BACKEND=langfuse`; exporta só os spans do SDK do Langfuse, com `mask` pelo
  `PiiRedactor`. Env: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`,
  `LANGFUSE_TRACING_ENVIRONMENT`, `LANGFUSE_RELEASE`, `LLM_TRACING_BACKEND` e as taxas do sampler.
- **`TraceSampler`** na aplicação: hash do `questionId`, taxa por ambiente com corte pela projeção
  mensal de `usage_daily.langfuse_units`; `QueryTracer` conta as units e isola falhas do adapter.
- **Trace `rag-query`** (mesmo `trace_id` do OTel) com o span `retrieval` e uma generation por
  provedor tentado (`answer` e, com a reescrita ligada, `rewrite`), com uso, custo de tabela,
  `billed_usd=0` e TTFT; cache e recusa por cobertura geram só a raiz. `langfuse_trace_id` e as units
  gravados com a resposta; `shadow_cost_usd` em todos os desfechos.
- **Feedback:** score `user_feedback` e, no 👎, annotation queue, em `BackgroundTasks`.
- **Apagamento:** `DeleteMyData` apaga os traces do usuário no Langfuse pelo hash.
- **`ops.yml`:** job `langfuse` (modelos e preços de `services/pricing.ts`, score config, annotation
  queue e `teko_langfuse_units_projected`).
- **Docs:** `observabilidade.md`, `backend.md`, `contas-e-cotas.md`, runbook `quota-exhausted.md`,
  `CONTRIBUTING.md`, `infra/grafana/README.md` e a ADR 0012 (número reservado no plano).

## Capabilities

### New Capabilities

- `llm-tracing`: traces de LLM no Langfuse (processor, amostragem, trace `rag-query`, custo,
  feedback, apagamento e o job do `ops.yml`).

### Modified Capabilities

- `telemetry`: o ponto de extensão passa a receber o `LangfuseSpanProcessor`, que filtra o que
  exporta.

## Impact

- `apps/api`: `config/env.ts`, `instrumentation.ts`, `composition-root.ts`,
  `adapters/out/telemetry/langfuse*.ts`, `adapters/out/persistence/.../pg-question-repository.ts`,
  `application/ports/llm-tracing.ts`, `application/services/{trace-sampler,generation-trace,
  pricing,provider-router,query-rewriter}.ts` e os casos de uso `ask-question`, `stream-answer`,
  `answer-pipeline`, `retrieve-evidence`, `hybrid-search` e `question-history`.
- `scripts/langfuse-ops.ts`, `.github/workflows/ops.yml`, `.github/scripts/ci-config.test.sh`.
- `infra/vercel/env.*.json`, `infra/planb-render/render.yaml`, `apps/api/.env.example`.
- Contas e segredos a cadastrar pelo mantenedor: chaves de runtime dos projetos `teko-prod` e
  `teko-staging` (Sensitive na Vercel e no Render) e um par por projeto para o job `langfuse` no
  environment `ops`.
