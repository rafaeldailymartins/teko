# Proposal

## Why

A F4 entrega a API completa. Antes das rotas de pergunta, autenticação e privacidade, a superfície
HTTP precisa da base comum que o desenho prevê (`docs/architecture/backend.md`): proteção contra
CSRF nas mutações (web e API na mesma origem, sem CORS, ADR 0029), rate limit da aplicação
compartilhado entre instâncias da Fluid compute, a cobertura pública, a paleta de dispositivos com
linha do tempo e diff, e as rotas de eval restritas à stack de CI.

## What Changes

- Guarda de `Origin` em `/api/v1/*`: método que muda estado com `Origin` diferente de `WEB_ORIGIN`
  (ou ausente) → 403 `forbidden`; POST, PUT e PATCH sem `content-type: application/json` → 415;
  query string numa mutação → 400 `validation_error`. `/api/auth/*` fica com o Better Auth.
- `PgRateLimitStore` (`app.rate_limits`, janela fixa de 60 s pelo relógio do banco) ligado ao
  `@fastify/rate-limit` só nas rotas que optam; `RATE_LIMIT_PER_MINUTE` (padrão 60).
- `GET /api/v1/coverage`: cobertura efetiva e `corpusVersion`, do mesmo cache de 10 min da
  `CheckCoverage` (`CoverageSource`).
- `GET /api/v1/provisions?q=&family=&at=`, `…/:stableKey/timeline` e `…/:stableKey/diff?from=&to=`:
  paleta (chave, rótulo ou texto), redações em ordem e diff por palavra e por campo.
- Plugin de eval (`GET /api/v1/_eval/search`) registrado só com `APP_ENV=ci`; o `buildApp` recusa o
  registro fora do CI.
- Contratos novos em `@teko/shared/contracts` (`provisions`).

## Capabilities

### New Capabilities

- `http-api`: superfície HTTP da API (proteção de mutações, rate limit, cobertura, dispositivos e
  rotas de eval).

## Impact

- `apps/api`: plugins, rotas, casos de uso `provisions` e `GetCoverage`, repositórios
  `pg-provision-repository` e `pg-rate-limit-store`, `config/env.ts`, `composition-root.ts`,
  `build-app.ts` e testes.
- `packages/shared`: contrato `provisions`.
- Docs: `backend.md` (superfície HTTP e variáveis).
