# Proposal

## Why

A F6 precisa de um destino de erros com a pilha resolvida pelos source maps, o mesmo `trace_id` do
Grafana e do Langfuse e um lugar para os relatórios de CSP e de Trusted Types. O roteiro deixava a
escolha entre o PostHog Error Tracking e o Sentry; a documentação oficial confirma que o PostHog
cobre os três pontos, a conta já existe (analytics de produto, #116) e a política publicada já o
declara como destino dos erros. A decisão fica na ADR 0037.

## What Changes

- **API:** `ErrorReporterPort` com o adapter do `posthog-node`, chamado pelo `setErrorHandler` só nos
  erros inesperados (`internal`), com scrubber de PII, `trace_id`, rota declarada, release por
  ambiente (`teko@X.Y.Z` na produção, `teko@<sha7>` nos demais) e flush em `BackgroundTasks` (500 ms)
  só quando houve erro. `POSTHOG_PROJECT_KEY` liga; sem ela, no-op.
- **Navegador:** captura de `error` e `unhandledrejection`, dos `ErrorBoundary` e das consultas que
  falham com 500, com o `posthog-js` carregado só no primeiro erro, numa instância própria em memória,
  sem depender do consentimento nem gravar nada no navegador; `trace_id` quando o erro vem da API.
- **Analytics:** `trace_id` também em `clarification_shown`, `provider_fallback` e `quota_reached`.
- **Source maps:** `.map` no web e na API, chunk ids injetados offline (`scripts/sourcemaps.ts`) e
  upload pronto para o deploy da F7 (composite `posthog-sourcemaps`), com o `posthog-cli` isolado em
  `tools/posthog-cli` e o binário conferido por sha256. Nenhum host serve os `.map`.
- **CSP:** `report-uri`, `report-to` e `Reporting-Endpoints` do PostHog (UE) quando o build tem a
  chave dos erros; sem ela, a CSP fica igual.
- **`source-watch`:** evento `source_watch_changed` ao PostHog quando há mudança nas fontes.
- O Sentry sai da arquitetura, das contas e do env.

## Capabilities

### New Capabilities

- `error-tracking`: destino dos erros da API e do navegador, scrubber, release, source maps.

### Modified Capabilities

- `web-build`: CSP com relatório ao PostHog e source maps fora do que é servido.
- `web-analytics`: `trace_id` nos eventos que vêm de uma resposta da API.
- `source-change-monitoring`: evento ao destino de erros quando há mudança.

## Impact

- `apps/api`: porta, adapter, `error-handler.ts`, `report-error.ts`, `build-app.ts`,
  `composition-root.ts`, `config/env.ts`, `domain/shared/build-info.ts`, `static-site` (`.map`) e
  regra nova no dependency-cruiser.
- `apps/web`: `lib/analytics` (captura e cliente de erros, `posthog-config.ts`, `chat-events.ts`),
  `instrumentation-client.ts`, `query-client.ts`, `BlockErrorBoundary`, `lib/env.ts`,
  `next.config.ts`, `scripts/lib/csp.ts`, `scripts/postbuild.ts`, e2e.
- `packages/shared`: catálogo de eventos.
- Raiz: `scripts/sourcemaps.ts`, `scripts/build-vercel-output.ts`, `scripts/caddy-static-site.ts`,
  `scripts/check-lockfile.ts`, `tools/posthog-cli`, `.github/actions/posthog-sourcemaps`,
  `e2e.yml`, `audit.yml`, `source-watch.yml`, `dependabot.yml`, `infra/ci/up.sh`,
  `infra/vercel/env.*.json`, `infra/planb-render/render.yaml`.
- Dependências: `posthog-node` 5.67.0 (catálogo) e `@posthog/cli` 0.19.0 (projeto isolado), com
  proveniência (adendo na ADR 0002).
- Docs: ADR 0037, `observabilidade.md`, `frontend.md`, `contas-e-cotas.md`, `README.md` da
  arquitetura, roadmap, ROPA, `CONTRIBUTING.md`.
