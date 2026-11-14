# Design

## Context

A API já tinha a imagem de CI (`apps/api/Dockerfile`, runtime distroless) e o perfil de rede da
stack (`trustProxy` na sub-rede `172.30.0.0/24` do Caddy, `x-request-id` do Caddy). Faltavam o
compose, o bootstrap do banco, a frente de mesma origem e o workflow.

## Decisions

- **Caddy serve o estático, como a CDN na Vercel**, e só `/api/*` e `/healthz` chegam à API. A raiz
  redireciona para `/pt-BR/` (na Vercel, por `Accept-Language`). O Plano B, em que a própria API
  serve o export, continua coberto pelos testes do `static-site`.
- **Migrações e fixture pelo runner**, com `node src/cli.ts seed-fixtures --migrate` na porta presa a
  `127.0.0.1`: a imagem da API não leva a CLI, as migrações nem a fixture, e o caminho de escrita é
  o mesmo da ingestão. Os roles e as extensões vêm de um `docker-entrypoint-initdb.d`, como no
  `globalSetup` dos testes de integração.
- **Postgres em `tmpfs` e sem `fsync`**: a stack é descartável.
- **Segredo do Better Auth gerado a cada subida**; o cookie da sessão de teste vai mascarado para o
  `$GITHUB_ENV` (ou para `infra/ci/.e2e.env`, fora do git, localmente).
- **Embeddings fake sem strict na stack:** as perguntas do e2e variam (sufixo aleatório para não
  cair no cache); o modo strict é das evals.
- **Jornadas de API só no projeto desktop** do Playwright; as de página rodam nos dois.
- **`harden-runner` em `audit`** nas primeiras semanas (imagens do Docker Hub e browsers do
  Playwright); `block` com a allowlist observada, como nos outros workflows.

## Risks / Trade-offs

- O job monta a imagem da API e o export do web a cada PR afetado (alguns minutos, em paralelo com
  o `ci`); o requisito de tempo do `ci-gate` vale para o caminho crítico.
- O Playwright baixa o Chromium a cada run (sem cache, para não confiar num artefato de outro run).

## Context7

| Biblioteca  | ID                       | Consulta                                                                 |
| ----------- | ------------------------ | ------------------------------------------------------------------------ |
| Playwright  | `/microsoft/playwright/v1.64.1` | `projects` com `devices`, `request` fixture, `forbidOnly`, `retries`     |
| Caddy       | `/websites/caddyserver_caddyfile` | `handle`, `reverse_proxy` com `header_up`, `try_files`, `request_body`   |
