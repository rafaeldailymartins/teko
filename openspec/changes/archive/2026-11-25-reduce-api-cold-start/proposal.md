# Proposal

## Why

Em 2026-11-25 a Vercel desativou a conta Hobby por passar das 4 h de "Fluid Active CPU" no período,
praticamente sem usuários reais. O consumo veio de automação: o Synthetic Monitoring chamava o
`/healthz` de `tekoia.vercel.app` e de `tekoia-staging.vercel.app` a cada 5 min (576 invocações por
dia), e com esse intervalo a instância esfria entre uma chamada e outra, então cada uma pagava um
cold start inteiro. Medido localmente, um cold start da Function (import do `server.mjs`, OTel,
container, app e o `GET /healthz`) custava 5,2 s de CPU, porque o boot carregava Better Auth, AI
SDK, PostHog, o migrator do Drizzle, a documentação OpenAPI e o Ajv do Fastify, nada disso usado
pelo `/healthz`.

## What Changes

- **Cold start:** Better Auth, AI SDK (Gemini e Groq), `posthog-node`, o migrator do Drizzle e os
  plugins da documentação OpenAPI passam a entrar por `import()` dinâmico no primeiro uso, atrás
  das mesmas portas (`AuthGateway`, `LlmModel`, `ErrorReporterPort`); o Fastify nasce com os
  compilers Zod (sem montar o Ajv e o fast-json-stringify que nenhuma rota usa). Uma regra do
  dependency-cruiser barra a volta do import estático. Fora da Vercel (processo de vida longa, com o
  guarda do event loop do `under-pressure`), os SDKs carregam antes de abrir a porta, como antes.
- **Medição:** `scripts/measure-cold-start.ts` mede o CPU de um cold start completo sobre a Function
  montada como no deploy, com o ambiente da produção e Sensitive de mentira (hosts `.invalid`).
  Mediana de 7: 5,2 s antes, 2,6 s depois (-50%).
- **Checks sintéticos:** o `/healthz` de produção vai de 5 min para 60 min (só prova a Function
  viva), o de staging fica desligado (o smoke de cada deploy o confere; a pausa é da conta e a
  produção a vê), e a landing (estática, sem Function) segue a cada 15 min como sinal da borda e da
  pausa. Os alertas `teko-synthetic-failed` e `teko-deployment-paused` passam a olhar 65 min (mais
  que a frequência do check mais lento), o de pausa vale para qualquer check `teko-*`, e a validação
  do Grafana as code reprova janela menor que a frequência do check ligado mais lento.

## Capabilities

### Modified Capabilities

- `operations-monitoring`: "Synthetic Monitoring sem acordar o banco" (frequências, staging
  desligado, 503 de qualquer check) e "Alerta de check sintético falho" (65 min).
- `http-api`: requisito novo, "Cold start sem o que o health check não usa".

## Impact

- `apps/api` (adapters de auth, LLM, error reporting, OpenAPI; `build-app.ts`, `composition-root.ts`,
  `.dependency-cruiser.cjs`) e `scripts/measure-cold-start.ts`.
- `infra/grafana/synthetic-monitoring.json`, `infra/grafana/alerts.json` (só as regras
  `teko-synthetic`), `scripts/lib/grafana-as-code.ts`, `scripts/grafana-apply.test.ts`.
- Docs: `infra/grafana/README.md`, `docs/architecture/observabilidade.md`,
  `docs/architecture/contas-e-cotas.md`, `docs/runbooks/ops-alerts.md`, `docs/status.md`.
- O apply no Grafana sai no próximo run do job `grafana` do `ops.yml` em `main` (push que muda
  `infra/grafana/`).
