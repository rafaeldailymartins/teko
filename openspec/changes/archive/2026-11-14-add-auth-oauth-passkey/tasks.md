# Tasks

## 1. Better Auth

- [x] 1.1 Catálogo e dependências (`better-auth`, `@better-auth/drizzle-adapter`, `@better-auth/passkey` 1.7.18)
- [x] 1.2 Schema `auth`, migração e FKs de `app` para `auth.user`; teste contra o `getAuthTables`
- [x] 1.3 Adapter `better-auth` (OAuth, passkey, sessão, cookies, rate limit em banco, telemetria desligada) e porta `AuthGateway`
- [x] 1.4 `/api/auth/*` na mesma origem, com o IP do cliente pela porta `ClientIp`

## 2. Usuário

- [x] 2.1 `GET /api/v1/me` e `POST /api/v1/me/onboarding`; `TERMS_VERSION`
- [x] 2.2 `ApplicationError` no error handler
- [x] 2.3 Rate limit com chave `user:<id>`

## 3. Segurança e boot

- [x] 3.1 Guarda de `Origin` em todo `/api/*`
- [x] 3.2 Asserções de boot (segredo e OAuth apps em staging e produção; pares; telemetria proibida)

## 4. Desenvolvimento e testes

- [x] 4.1 `cli seed-dev-session` e o script `seed:dev-session`
- [x] 4.2 Integração: 401, sessão semeada, `get-session` pelo `relations-v2`, assinatura falsa, sign-out, onboarding, OAuth do GitHub, origem estrangeira, chave do rate limit

## 5. Documentação

- [x] 5.1 `backend.md` (autenticação e variáveis) e `status.md`
