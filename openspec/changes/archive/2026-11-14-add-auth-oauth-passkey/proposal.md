# Proposal

## Why

As rotas de pergunta, histórico e DSR da F4 exigem um usuário: login sem e-mail (não há domínio
próprio para enviar e-mail), sessão por cookie na mesma origem (ADR 0029), maioridade, aceite dos
Termos e país de residência, que alimenta a política regional de provedores. O desenho está em
`docs/architecture/backend.md` ("Autenticação").

## What Changes

- Better Auth 1.7.18 com o adapter do Drizzle (`/relations-v2`) e o plugin de passkey, os três na
  mesma linha e com proveniência. OAuth GitHub e Google; passkey registrada depois do primeiro
  login; sem e-mail e senha; telemetria desligada (e as variáveis que a ligariam, proibidas).
- Schema `auth` escrito à mão (sem o CLI do Better Auth, que exigiria `npx`), com IDs `uuid` e
  `uuidv7()` como default, conferido por teste contra o `getAuthTables` do próprio Better Auth.
  FKs `app.questions.user_id` e `app.feedback.user_id` para `auth.user`, com `ON DELETE CASCADE`.
- `/api/auth/*` na mesma origem; o IP do cliente chega ao rate limit do Better Auth (em banco) pela
  porta `ClientIp`. Sessão de 7 dias, `cookieCache` de 5 min, cookies `teko` (produção) ou
  `teko-stg`, com `__Secure-` em https.
- `GET /api/v1/me` e `POST /api/v1/me/onboarding` (18+, versão vigente dos Termos, país).
  `TERMS_VERSION` define a versão vigente; uma versão nova pede novo aceite.
- `ApplicationError`: erro da aplicação com o código do contrato (`onboarding_required`,
  `quota_exceeded` com `meta`...).
- A guarda de `Origin` passa a valer em todo `/api/*`: o Better Auth só confere a origem quando a
  requisição traz cookie.
- Rate limit da aplicação com chave `user:<id>` quando há sessão.
- `cli seed-dev-session` (`pnpm --filter @teko/api seed:dev-session`): usuário com onboarding e
  sessão direto no banco, com o cookie assinado, para o login local e o e2e; só development e ci.
- Boot: em staging e produção com `DATABASE_URL`, `BETTER_AUTH_SECRET` (≥ 32) e os dois OAuth apps
  são obrigatórios; id e segredo de cada app vêm juntos.

## Capabilities

### New Capabilities

- `authentication`: login, sessão, onboarding e sessão de desenvolvimento.

### Modified Capabilities

- `http-api`: a guarda de `Origin` cobre `/api/auth/*`; o rate limit usa o usuário da sessão.

## Impact

- `apps/api`: adapter `better-auth`, schema e migração `auth`, plugin HTTP, rotas `/me`,
  casos de uso de usuário, CLI, `config/env.ts`, `composition-root.ts` e testes.
- `packages/shared`: contrato `me` e esquemas do onboarding.
- `pnpm-workspace.yaml` (catálogo) e lockfile.
- Docs: `backend.md` (autenticação e variáveis).
- Fora do repositório (mantenedor): os OAuth apps de staging e produção e as env vars Sensitive
  `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_*` e `GOOGLE_CLIENT_*`, que o deploy da F7 vai exigir.
