# Tasks

## 1. Stack de CI

- [x] 1.1 `infra/ci/compose.yaml` (Postgres com roles do Neon, API com os limites da Fluid, Caddy) e `Caddyfile`
- [x] 1.2 `infra/ci/up.sh` (imagem, export, migrações, fixture e sessão de teste)

## 2. E2E

- [x] 2.1 Playwright no `apps/web` (catálogo, config com Chromium e viewport mobile)
- [x] 2.2 Jornadas da F4 (mesma origem, inglês, cobertura, sessão por cookie, outra origem, pergunta com stream)
- [x] 2.3 `e2e.yml` e o job `e2e` no `ci-gate`; `ci-config.test.sh` e actionlint

## 3. Documentação

- [x] 3.1 `qualidade-e-seguranca.md`, `ci-cd-e-ambientes.md` e `status.md`
