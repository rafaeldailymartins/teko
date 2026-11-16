# Design

## Context

Better Auth 1.7.18 (catálogo) com o adapter `relations-v2`, sessão por cookie, rate limit em banco e
a guarda de `Origin` própria em `/api/auth/*` (ADR 0019). A tabela `auth.account` já tem a coluna
`password` (o schema escrito à mão segue o `getAuthTables`). O web não usa o cliente do Better Auth
(ADR 0035). A decisão está na ADR 0036; a tela de entrada fica para a onda de UI do redesign.

## Decisions

- **`autoSignIn: false`.** Com ele, o Better Auth responde o cadastro de um e-mail que já existe com
  o mesmo 200 de um cadastro novo (usuário sintético, `token: null`), calcula um hash para igualar o
  tempo e não toca no banco. Com `autoSignIn: true`, o mesmo caso daria 422
  `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, que revela a conta. O preço é o web chamar a entrada logo
  depois do cadastro; uma entrada recusada ali vira `accountUnavailable` no web, com mensagem que não
  afirma nada.
- **Validação do cadastro num gancho `before`** (`createAuthMiddleware`, só em `/sign-up/email`),
  com o `emailSignUpRequestSchema` de `@teko/shared/contracts`. O Better Auth aceitaria nome vazio,
  foto por URL e campos extras; o gancho recusa com 400 e um código por campo
  (`PASSWORD_TOO_SHORT`, `PASSWORD_TOO_LONG`, `INVALID_EMAIL`, `INVALID_NAME`,
  `VALIDATION_ERROR`) e repassa o nome aparado. Os campos do onboarding já têm `input: false`.
- **Senha:** 12 a 128 em `string.length` (a mesma conta do `assertPasswordNotTooShort` do Better
  Auth, para o web e a API concordarem), sem composição e sem aparar. O scrypt do
  `@better-auth/utils` normaliza em NFKC antes do hash. Na entrada, a senha só tem o teto: uma curta
  demais recebe o mesmo 401 de uma errada.
- **Vínculo de contas.** O `handleOAuthUserInfo` do Better Auth 1.7.18 recusa o vínculo implícito
  quando o usuário local não tem o e-mail verificado (`requireLocalEmailVerified`, padrão `true`,
  marcado como deprecated porque vira incondicional). A conta de senha nasce com
  `emailVerified: false`, e as rotas que mudariam isso ficam desligadas. A configuração explícita é
  `trustedProviders: []` (nenhum provedor é aceito só pelo nome), `allowDifferentEmails: false` e
  `updateUserInfoOnLink: false`; a opção deprecated não é escrita. `disableImplicitLinking` foi
  descartado: também quebraria o vínculo GitHub ↔ Google, que hoje funciona com e-mails confirmados.
  O teste de integração prova os dois sentidos com o callback do GitHub e o `fetch` simulado.
- **`disabledPaths`** para as rotas que dependem de e-mail: sem `sendVerificationEmail` nem
  `sendResetPassword` elas já falhariam, mas o 404 deixa o comportamento explícito e testável.
- **Rate limit:** `customRules` em `/sign-in/email` (5 por 60 s) e `/sign-up/email` (5 por 600 s),
  contra os 3 por 10 s do padrão do Better Auth para `/sign-in*` e `/sign-up*`. As janelas ficam em
  `auth.rate_limit` (IP e caminho), que a manutenção não apagava; agora apaga as paradas há mais de
  um dia, junto com as de `app.rate_limits`.
- **Métodos de entrada** na porta `AuthGateway` (`methods`), calculados do que foi configurado
  (`authMethodsOf`). A rota `GET /api/v1/auth/providers` fica sem rate limit da aplicação (o store
  dele é o Postgres) e responde 503 sem o Better Auth. No web, a query tem `staleTime` infinito: é
  configuração do deploy.
- **Web:** `signUpWithEmail` faz cadastro e entrada; `EmailAuthError` carrega a falha que a tela
  explica, e o resto (rede, 403, 5xx) segue como `ApiError`. As mutações relêem o `/me`.
- **E2E pela API** (`email-auth.spec.ts`), só no projeto desktop, com um cadastro e uma entrada por
  tentativa: todas as jornadas da stack saem do mesmo IP e contam no rate limit.

## Context7

| Biblioteca     | ID                                 | Consulta                                                                        |
| -------------- | ---------------------------------- | ------------------------------------------------------------------------------- |
| Better Auth    | `/better-auth/better-auth/v1.7.15` | opções de `emailAndPassword` (tamanho de senha, confirmação, `autoSignIn`)       |
| Better Auth    | `/better-auth/better-auth/v1.7.15` | proteção contra enumeração no cadastro, `customSyntheticUser`                    |
| Better Auth    | `/better-auth/better-auth/v1.7.15` | `account.accountLinking` (`trustedProviders`, `allowDifferentEmails`, implícito) |
| Better Auth    | `/better-auth/better-auth/v1.7.15` | `hooks.before` com `createAuthMiddleware` e `APIError`                           |
| Playwright     | `/microsoft/playwright`            | cookies do `APIRequestContext` entre requisições                                 |
| TanStack Query | `/tanstack/query`                  | `invalidateQueries` no `onSuccess` de mutação                                    |

O Context7 só tem a 1.7.15 do Better Auth; o comportamento da 1.7.18 do catálogo foi conferido no
código instalado (`sign-up.mjs`, `sign-in.mjs`, `oauth2/link-account.mjs`, `api/rate-limiter`).
