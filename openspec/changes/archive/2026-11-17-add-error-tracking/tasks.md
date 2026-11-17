# Tasks

## 1. Decisão e dependências

- [x] 1.1 ADR 0037 (PostHog Error Tracking, alternativas e consequências); o Sentry sai da
  arquitetura, das contas, do env, do Dependabot e do SECURITY.md
- [x] 1.2 `posthog-node` 5.67.0 no catálogo e `@posthog/cli` 0.19.0 em `tools/posthog-cli` (lockfile,
  auditoria, Dependabot e `check-lockfile`), com data, licença e proveniência conferidas (adendo na
  ADR 0002); `install-binary.mjs` com o sha256 fixado e `postinstall` desligado

## 2. API

- [x] 2.1 `ErrorReporterPort` e `noopErrorReporter`; adapter do `posthog-node` com envio imediato,
  `before_send` só de `$exception` e sem linhas de código-fonte; regra no dependency-cruiser
- [x] 2.2 Scrubber (`PiiRedactor`, credenciais de URL, mensagem cortada, sem `cause`)
- [x] 2.3 Hook do `setErrorHandler` só para `internal`, com flush em `BackgroundTasks` (500 ms)
- [x] 2.4 Release por ambiente (`errorTrackingRelease`), `POSTHOG_PROJECT_KEY` no env, aviso no boot
  de staging e produção, `infra/vercel/env.*.json`, `render.yaml` e `.env.example`

## 3. Web

- [x] 3.1 Captura de `error` e `unhandledrejection` no `instrumentation-client.ts`, nos `ErrorBoundary`
  e nas consultas e mutações com 500 `internal`; SDK por `import()` no primeiro erro, instância
  própria em memória, `trace_id` e release
- [x] 3.2 `trace_id` em `clarification_shown`, `provider_fallback` e `quota_reached` (catálogo e chat)
- [x] 3.3 CSP com `report-uri`, `report-to` e `Reporting-Endpoints` (manifesto, Vercel, Plano B e
  Caddy)

## 4. Source maps

- [x] 4.1 `productionBrowserSourceMaps` e os `.map` fora do que é servido (`build-vercel-output`,
  Plano B e Caddy)
- [x] 4.2 `scripts/sourcemaps.ts` (inject offline e upload) e a composite `posthog-sourcemaps`;
  inject na stack de CI (`up.sh`, `e2e.yml`)

## 5. source-watch

- [x] 5.1 Evento `source_watch_changed` com a chave do environment `staging` e o host no
  harden-runner

## 6. Docs

- [x] 6.1 `observabilidade.md`, `frontend.md`, `contas-e-cotas.md`, README da arquitetura, roadmap,
  ROPA e `CONTRIBUTING.md`

## 7. Testes e gates

- [x] 7.1 Unitários: scrubber, reporter, hook do error handler, release, env, captura e cliente de
  erros do web, `before_send`, catálogo, CSP com e sem chave, `.map` fora do que é servido,
  `sourcemaps.ts`
- [x] 7.2 E2E na stack de CI: 500 da API vira `$exception` na UE com o `trace_id`, sem cookie nem
  storage; chunks com chunk id e `.map` em 404; CSP com o relatório
- [x] 7.3 `pnpm verify`, `pnpm verify:full`, actionlint, `ci-config.test.sh` e mutação local
