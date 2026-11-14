# Proposal

## Why

A matriz de testes prevê uma stack descartável de CI (`infra/ci/`) onde rodam e2e, k6, ZAP ativo e
as evals de geração, com o estático e a API na mesma origem, como na Vercel. A F4 entrega a stack e
o `e2e.yml` no `pr-gate.yml`; as jornadas de interface chegam com o front da F5.

## What Changes

- `infra/ci/compose.yaml`: Postgres com pgvector (mesmo digest do compose local, roles do Neon),
  a imagem candidata da API (`apps/api/Dockerfile`, limites de 1 vCPU e 2 GB) e o Caddy na frente,
  servindo o export do web e mandando `/api/*` e `/healthz` para a API em `http://localhost:8080`.
- `infra/ci/up.sh`: monta imagem e export, aplica as migrações e a fixture pelo `cli seed-fixtures`,
  sobe API e Caddy e cria a sessão de teste pelo `cli seed-dev-session`.
- `.github/workflows/e2e.yml` (PR com web ou api afetados, nightly e dispatch) com Playwright
  (Chromium e viewport mobile), e o job `e2e` no `ci-gate`, podendo pular como o `perf`.
- Jornadas da F4: mesma origem (estático e `/healthz`), versão em inglês, cobertura pública, sessão
  por cookie, mutação de outra origem recusada e pergunta com stream e releitura.

## Capabilities

### Modified Capabilities

- `quality-gates`: o `ci-gate` agrega o `e2e`; PR só de documentação também pula o e2e.

## Impact

- `infra/ci/`, `.github/workflows/{e2e,pr-gate}.yml`, `.github/scripts/ci-config.test.sh`.
- `apps/web`: `@playwright/test` (catálogo), `playwright.config.ts` e `e2e/`.
- Docs: `qualidade-e-seguranca.md`, `ci-cd-e-ambientes.md` e `status.md`.
