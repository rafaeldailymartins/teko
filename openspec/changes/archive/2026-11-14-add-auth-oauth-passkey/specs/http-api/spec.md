# Spec Delta

## MODIFIED Requirements

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
