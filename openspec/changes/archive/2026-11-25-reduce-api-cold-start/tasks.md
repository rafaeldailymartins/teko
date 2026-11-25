# Tasks

## 1. Medição

- [x] 1.1 `scripts/measure-cold-start.ts` e o teste (verificar: `pnpm test:scripts`)
- [x] 1.2 Mediana antes e depois sobre a Function montada como no deploy (verificar: tabela do
  `design.md`)

## 2. Cold start da API

- [x] 2.1 `lazyModule` e o `AuthGateway` do Better Auth sob demanda (verificar:
  `lazy-better-auth.test.ts`, `better-auth.test.ts`)
- [x] 2.2 Cadeia de LLM sob demanda (verificar: `lazy-llm-chain.test.ts`, `ai-sdk-llm.test.ts`)
- [x] 2.3 `posthog-node`, migrator do Drizzle e documentação OpenAPI por `import()` (verificar:
  `posthog-error-reporter.test.ts`, `openapi.test.ts`, `pnpm --filter @teko/api test:integration`)
- [x] 2.4 Compilers Zod na criação do Fastify (verificar: `pnpm --filter @teko/api test:unit` e
  integração)
- [x] 2.5 Regra `cold-start-sdks-only-by-dynamic-import` (verificar: `pnpm lint:deps`, e um import
  estático de teste reprovado)

- [x] 2.6 `Container.warmUp` aguardado pelo `buildApp` com o guarda do event loop (fora da Vercel)
  (verificar: `build-app.test.ts` e a integração `auth-email.test.ts`)

## 3. Synthetic Monitoring

- [x] 3.1 `/healthz` de produção a cada 60 min, o de staging desligado (verificar:
  `scripts/grafana-apply.test.ts`)
- [x] 3.2 Alertas `teko-synthetic-failed` e `teko-deployment-paused` com 65 min, e a validação da
  janela e da frequência dos checks que invocam a Function (verificar:
  `node scripts/grafana-apply.ts --validate`)

## 4. Documentos e specs

- [x] 4.1 `infra/grafana/README.md`, `observabilidade.md`, `contas-e-cotas.md`, `ops-alerts.md` e
  `docs/status.md` (verificar: revisão do diff)
- [x] 4.2 Deltas de `operations-monitoring` e `http-api` (verificar: `pnpm spec:validate`)
