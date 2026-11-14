# Design

## Context

O Better Auth roda dentro da Function única, com o mesmo pool `pg` do runtime (`teko_app`). O
Drizzle do runtime não declara relations; o adapter `relations-v2` só usa a API relacional em
joins, que ficam desligados, e aceita o objeto `schema` direto.

## Decisions

- **Schema escrito à mão.** O CLI do Better Auth (`auth generate`) é um pacote fora do lockfile
  (regra: nada de `npx`). As propriedades das tabelas usam os nomes de campo do Better Auth, e o
  `snakeCase.schema('auth')` grava as colunas em snake_case. Um teste unitário compara cada modelo
  e campo com o `getAuthTables` do Better Auth, inclusive a obrigatoriedade.
- **`uuidv7()` como default dos IDs.** O Better Auth gera UUIDs (`generateId: 'uuid'`), mas o rate
  limit em banco insere com `id DEFAULT`; sem default no banco, o insert falha.
- **`CREATE SCHEMA IF NOT EXISTS "auth"`** na migração gerada: o schema existe desde a migração de
  extensões, por causa dos grants e dos default privileges do `teko_app`.
- **IP do cliente por header interno** (`x-teko-client-ip`), preenchido pela porta `ClientIp` e
  apagado se vier do cliente. Vale igual na Vercel (`x-real-ip`), no Render e no CI, sem configurar
  o Better Auth por plataforma.
- **Guarda de `Origin` em `/api/auth/*`.** O `originCheck` do Better Auth pula a checagem quando a
  requisição não traz cookie; um `sign-in/social` iniciado por outro site passava (teste de
  integração). A regra de query string continua só em `/api/v1/*`.
- **Onboarding pela versão vigente dos Termos** (`TERMS_VERSION`). Com o `cookieCache`, o cookie
  pode dizer "pendente" por até 5 min depois do onboarding; antes de recusar com
  `onboarding_required`, a rota relê a sessão do banco.
- **`seed-dev-session` sem endpoint HTTP.** Grava usuário e sessão direto no Postgres e assina o
  token como o Better Auth (HMAC-SHA256 em base64, conferido no teste contra o `makeSignature` do
  pacote). Recusa staging e produção.
- **Nomes das env vars** iguais aos de `infra/vercel/env.*.json` (`GITHUB_CLIENT_ID`...).

## Risks / Trade-offs

- O schema escrito à mão pode divergir numa atualização do Better Auth: o teste contra o
  `getAuthTables` reprova o PR do Dependabot nesse caso.
- `cookieCache` de 5 min: uma sessão revogada continua válida no cookie por até 5 min; as rotas de
  DSR leem a sessão do banco (`fresh`), e a janela fica registrada no `ropa.md` (mudança de
  privacidade).

## Context7

| Biblioteca  | ID                                  | Consulta                                                                   |
| ----------- | ----------------------------------- | -------------------------------------------------------------------------- |
| Better Auth | `/better-auth/better-auth/v1.7.15`  | integração com Fastify, adapter Drizzle `relations-v2`, `generateId: 'uuid'` |
| Better Auth | `/better-auth/better-auth/v1.7.15`  | rate limit em banco, `cookieCache` e `disableCookieCache`                  |
| Better Auth | `/better-auth/better-auth/v1.7.15`  | plugin de passkey (`rpID`, `rpName`, `origin`) e tabela `passkey`           |
