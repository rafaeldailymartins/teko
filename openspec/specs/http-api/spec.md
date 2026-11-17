# http-api Specification

## Purpose

Define a superfície HTTP da API do Tekó: proteção das mutações, rate limit da aplicação,
cobertura pública, leitura de dispositivos, a lista de conversas do usuário e as rotas de avaliação
restritas ao CI.

## Requirements

### Requirement: Mutações só da própria origem

Toda requisição a `/api/*` (inclusive `/api/auth/*`) com método diferente de GET, HEAD e OPTIONS
MUST trazer `Origin` igual a `WEB_ORIGIN`; caso contrário a API SHALL responder 403 `forbidden`.
POST, PUT e PATCH MUST trazer `content-type: application/json` (senão 415), e uma mutação em
`/api/v1/*` com query string SHALL ser recusada com 400 `validation_error`.

#### Scenario: Origin de outro site

- **WHEN** chega `POST /api/v1/questions` com `Origin: https://evil.example`
- **THEN** a API responde 403 com problem+json `forbidden`

#### Scenario: Query string na mutação

- **WHEN** chega `POST /api/v1/questions?question=...` da própria origem
- **THEN** a API responde 400 `validation_error`

#### Scenario: Login iniciado por outro site

- **WHEN** chega `POST /api/auth/sign-in/social` sem cookie e com `Origin: https://evil.example`
- **THEN** a API responde 403 `forbidden`, sem chegar ao Better Auth

### Requirement: Rate limit compartilhado entre instâncias

As rotas com rate limit da aplicação MUST contar as requisições em Postgres (`app.rate_limits`),
numa janela fixa de 60 s calculada pelo relógio do banco, de modo que o limite SHALL valer somado
entre todas as instâncias que apontam para o mesmo banco. A chave SHALL ser o usuário da sessão,
quando há sessão, e o IP do cliente pela porta da plataforma, quando não há. Excedido o limite, a
resposta SHALL ser 429 `rate_limited` com `Retry-After`.

#### Scenario: Duas instâncias

- **WHEN** o limite é 3 por minuto e quatro requisições do mesmo cliente se alternam entre duas instâncias
- **THEN** as três primeiras passam e a quarta recebe 429 `rate_limited`

#### Scenario: Chave por usuário

- **WHEN** um usuário com sessão consulta `GET /api/v1/provisions`
- **THEN** a janela é contada na chave `user:<id>` dele

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

### Requirement: Lista de conversas do usuário

`GET /api/v1/conversations` MUST exigir sessão e listar só as conversas do usuário da sessão, da
última pergunta mais recente para a mais antiga. Cada item SHALL trazer `conversationId`, o título
derivado da primeira pergunta redigida (uma linha, até 80 caracteres), a contagem de perguntas, o
instante da última pergunta e a data de referência dela. A resposta SHALL sair com
`Cache-Control: private, no-store` e passar pelo rate limit da aplicação.

#### Scenario: Conversas de outro usuário

- **WHEN** outro usuário pede a lista
- **THEN** nenhuma conversa do primeiro aparece

#### Scenario: Depois da exclusão da conta

- **WHEN** o usuário apaga a conta e reusa o cookie antigo em `GET /api/v1/conversations`
- **THEN** a API responde 401

### Requirement: Paginação da lista de conversas por cursor

A lista de conversas MUST vir em páginas de 20, com `nextCursor` opaco (`null` na última página) e
empate de instante resolvido pelo id da conversa. A paginação MUST NOT repetir nem pular conversas,
inclusive quando os instantes só diferem nos microssegundos. Cursor que a API não emitiu ou
parâmetro desconhecido SHALL dar 400 `validation_error`.

#### Scenario: Duas páginas

- **WHEN** o usuário tem 25 conversas e pede a primeira página e depois a do `nextCursor`
- **THEN** recebe 20 e depois 5 conversas, sem repetição, e o `nextCursor` da segunda é `null`

#### Scenario: Cursor inventado

- **WHEN** chega `GET /api/v1/conversations?cursor=bad`
- **THEN** a API responde 400 `validation_error`, sem consultar as perguntas

### Requirement: Exclusão de uma conversa

`DELETE /api/v1/conversations/:id` MUST exigir sessão lida do banco e apagar, numa transação, todas
as perguntas do usuário da sessão naquela conversa, com as respostas, as citações e o feedback delas,
respondendo 204. Conversa inexistente ou de outro usuário SHALL dar o mesmo 404 `not_found`, sem
apagar nada.

#### Scenario: O dono exclui

- **WHEN** o usuário com uma conversa de duas perguntas, uma delas com feedback, pede `DELETE /api/v1/conversations/<id>`
- **THEN** a API responde 204, as perguntas e o feedback somem, `GET /api/v1/questions/<id da pergunta>` responde 404 e a conversa sai de `GET /api/v1/conversations`

#### Scenario: Conversa de outro usuário

- **WHEN** outro usuário pede a exclusão da conversa
- **THEN** a API responde o mesmo 404 de uma conversa que não existe, e a conversa continua lá

### Requirement: Exclusão com resposta em andamento

Com uma pergunta da conversa em stream ativo (claim há menos de 110 s), a exclusão MUST responder
409 `stream_busy` sem apagar nada. Um stream parado há mais tempo SHALL NOT impedir a exclusão.

#### Scenario: Resposta em andamento

- **WHEN** uma pergunta da conversa está em stream há 5 s e o dono pede a exclusão
- **THEN** a API responde 409 `stream_busy`, e nenhuma pergunta é apagada

### Requirement: Exclusão sem devolver a cota

A exclusão de uma conversa MUST NOT mudar o uso do dia (`usage_daily`) nem o cache de respostas:
excluir não devolve perguntas à cota, e a resposta em cache continua servindo a outros usuários.

#### Scenario: A cota fica igual

- **WHEN** o usuário que já fez três perguntas hoje exclui uma conversa com duas delas
- **THEN** `GET /api/v1/me/quota` continua mostrando três perguntas usadas

#### Scenario: Cache de outro usuário

- **WHEN** um usuário exclui a conversa cuja resposta foi para o cache, e outro faz a mesma pergunta na mesma data
- **THEN** o outro recebe a resposta do cache, sem chamar o LLM

### Requirement: ID de rastreio em toda resposta

Toda resposta da API MUST trazer o header `x-trace-id` com o `trace_id` W3C (32 hex) da requisição:
o do span da requisição ou, sem telemetria, o do `traceparent` recebido ou um id aleatório no mesmo
formato. O `traceId` dos Problem Details e o do `finish` do stream SHALL ter o mesmo valor.

#### Scenario: Erro com Problem Details

- **WHEN** `GET /api/v1/questions/<id-inexistente>` responde 404 com `traceparent` enviado
- **THEN** o header `x-trace-id` e o `traceId` do corpo são o `trace_id` do `traceparent`

#### Scenario: Sem traceparent

- **WHEN** uma requisição a `/api` chega sem `traceparent`
- **THEN** a resposta traz `x-trace-id` com 32 caracteres hexadecimais
