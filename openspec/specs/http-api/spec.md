# http-api Specification

## Purpose

Define a superfície HTTP da API do Tekó: proteção das mutações, rate limit da aplicação,
cobertura pública, leitura de dispositivos e as rotas de avaliação restritas ao CI.

## Requirements

### Requirement: Mutações só da própria origem

Toda requisição a `/api/v1/*` com método diferente de GET, HEAD e OPTIONS MUST trazer `Origin`
igual a `WEB_ORIGIN`; caso contrário a API SHALL responder 403 `forbidden`. POST, PUT e PATCH MUST
trazer `content-type: application/json` (senão 415), e uma mutação com query string SHALL ser
recusada com 400 `validation_error`.

#### Scenario: Origin de outro site

- **WHEN** chega `POST /api/v1/questions` com `Origin: https://evil.example`
- **THEN** a API responde 403 com problem+json `forbidden`

#### Scenario: Query string na mutação

- **WHEN** chega `POST /api/v1/questions?question=...` da própria origem
- **THEN** a API responde 400 `validation_error`

### Requirement: Rate limit compartilhado entre instâncias

As rotas com rate limit da aplicação MUST contar as requisições em Postgres (`app.rate_limits`),
numa janela fixa de 60 s calculada pelo relógio do banco, de modo que o limite SHALL valer somado
entre todas as instâncias que apontam para o mesmo banco. Excedido o limite, a resposta SHALL ser
429 `rate_limited` com `Retry-After`.

#### Scenario: Duas instâncias

- **WHEN** o limite é 3 por minuto e quatro requisições do mesmo cliente se alternam entre duas instâncias
- **THEN** as três primeiras passam e a quarta recebe 429 `rate_limited`

### Requirement: Cobertura pública em cache

`GET /api/v1/coverage` MUST responder, sem sessão e sem rate limit da aplicação, a cobertura
efetiva de cada família e a `corpusVersion`, lidas do mesmo cache em memória de 10 min usado pela
checagem de cobertura das perguntas.

#### Scenario: Cache dividido

- **WHEN** uma pergunta acabou de ler a cobertura e logo depois chega `GET /api/v1/coverage`
- **THEN** a rota responde sem nova leitura de `corpus.coverage`

### Requirement: Paleta, linha do tempo e diff de dispositivos

A API MUST buscar dispositivos vigentes numa data por chave, rótulo ou texto
(`GET /api/v1/provisions`), listar as redações de um dispositivo em ordem de vigência
(`…/:stableKey/timeline`) e comparar as redações vigentes em duas datas (`…/:stableKey/diff`),
com diff por palavra e por campo, só sobre redações publicadas no ambiente. Chave inexistente
SHALL dar 404 `not_found`.

#### Scenario: Diff do art. 76, § 6º do RCTE

- **WHEN** chega `GET /api/v1/provisions/go:rcte:art:76:par:6/diff?from=2006-05-01&to=2026-11-01`
- **THEN** a resposta traz as duas redações e segmentos de inserção ou remoção entre elas

### Requirement: Rotas de eval só no CI

As rotas `/api/v1/_eval/*` MUST ser registradas só com `APP_ENV=ci`; em staging e produção SHALL
responder 404, e o boot MUST falhar se o registro for pedido fora do CI.

#### Scenario: Staging

- **WHEN** chega `GET /api/v1/_eval/search` com `APP_ENV=staging`
- **THEN** a API responde 404 `not_found`
