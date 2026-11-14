# Spec Delta

## Purpose

Define como o Tekó autentica usuários (OAuth e passkey, sem e-mail), mantém a sessão por cookie
na mesma origem e exige maioridade, aceite dos Termos e país de residência antes do uso.

## ADDED Requirements

### Requirement: Login sem e-mail

A API MUST autenticar por OAuth (GitHub e Google) e por passkey registrada depois do primeiro
login, pelo Better Auth em `/api/auth/*`, e SHALL NOT oferecer login por e-mail e senha. A
telemetria do Better Auth MUST ficar desligada, e as variáveis que a ligariam SHALL derrubar o
boot.

#### Scenario: Início do OAuth do GitHub

- **WHEN** a web chama `POST /api/auth/sign-in/social` com `provider: github`
- **THEN** a resposta traz a URL de autorização do GitHub com o callback `<WEB_ORIGIN>/api/auth/callback/github`

### Requirement: Sessão por cookie

A sessão MUST durar 7 dias, renovada a cada dia de uso, num cookie `HttpOnly` e `SameSite=Lax`
com o prefixo `teko` em produção e `teko-stg` nos demais ambientes (`__Secure-` em https). O
`cookieCache` SHALL ter no máximo 5 min, e as leituras que não podem confiar numa sessão revogada
MUST ler do banco. Cookie com assinatura inválida SHALL ser tratado como ausência de sessão.

#### Scenario: Sem sessão

- **WHEN** chega `GET /api/v1/me` sem cookie de sessão
- **THEN** a API responde 401 `unauthenticated`

#### Scenario: Sign-out

- **WHEN** o usuário sai por `POST /api/auth/sign-out`
- **THEN** o mesmo cookie deixa de autenticar `GET /api/v1/me`

### Requirement: Onboarding antes do uso

O usuário MUST declarar 18+, aceitar a versão vigente dos Termos (`TERMS_VERSION`) e informar o
país de residência (ISO 3166-1 alpha-2) em `POST /api/v1/me/onboarding` antes de usar as rotas que
o exigem, que SHALL responder 403 `onboarding_required` enquanto isso faltar. Uma versão dos Termos
diferente da vigente SHALL ser recusada com `validation_error`, e uma versão nova dos Termos MUST
pedir novo aceite.

#### Scenario: Termos antigos

- **WHEN** o usuário envia o onboarding com uma versão dos Termos que não é a vigente
- **THEN** a API responde 400 `validation_error` e nada é gravado

#### Scenario: Onboarding concluído

- **WHEN** o usuário envia o onboarding com 18+, a versão vigente e o país `PT`
- **THEN** `GET /api/v1/me` passa a mostrar `onboarding.required: false` e o país `PT`

### Requirement: Login obrigatório na API publicada

Em staging e produção com banco, o boot MUST exigir `BETTER_AUTH_SECRET` com ao menos 32
caracteres e os OAuth apps do GitHub e do Google; o id e o segredo de cada app SHALL vir juntos.

#### Scenario: Produção sem segredo

- **WHEN** a API sobe com `APP_ENV=production` e `DATABASE_URL`, sem `BETTER_AUTH_SECRET`
- **THEN** o boot falha citando `BETTER_AUTH_SECRET`

### Requirement: Sessão de desenvolvimento

`cli seed-dev-session` MUST criar (ou reaproveitar) um usuário com onboarding concluído e uma
sessão direto no banco, sem endpoint HTTP, e imprimir o cookie assinado como o Better Auth o
assina; SHALL recusar `APP_ENV` diferente de development e ci.

#### Scenario: Login local

- **WHEN** o desenvolvedor roda `pnpm --filter @teko/api seed:dev-session` com o banco local
- **THEN** o cookie impresso autentica `GET /api/v1/me` com onboarding concluído
