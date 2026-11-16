# Proposal

## Why

O login do Tekó é só OAuth (GitHub e Google) e passkey (ADR 0019). Localmente, sem OAuth apps, não
há entrada real, e quem não quer ligar uma conta do GitHub ou do Google não consegue usar o
serviço. O mantenedor decidiu, em 2026-11-16, oferecer e-mail e senha em todos os ambientes, sem
confirmação de e-mail e sem recuperação de senha: sem domínio próprio, não há remetente de e-mail
(custo zero). Sem confirmação, o desenho precisa impedir que um e-mail alheio vire tomada de conta e
que as respostas revelem quais e-mails têm conta.

## What Changes

- Better Auth com `emailAndPassword` (cadastro com nome, e-mail e senha; entrada), sem confirmação
  de e-mail, sem login automático no cadastro (proteção contra enumeração), senha de 12 a 128,
  validação do cadastro por um gancho, rotas de confirmação, troca de e-mail e recuperação de senha
  desligadas e rate limit mais rígido nas rotas de e-mail.
- Contas separadas por método: GitHub ou Google com o e-mail de uma conta de senha não entram nela,
  e o cadastro por senha de um e-mail de conta OAuth não cria credencial.
- `GET /api/v1/auth/providers`: métodos de entrada ativos no ambiente, com contrato em
  `@teko/shared/contracts`, OpenAPI e cliente do web regenerados.
- Web (sem tela): `signUpWithEmail`, `signInWithEmail`, `EmailAuthError`, `useAuthProviders`,
  `useEmailSignIn` e `useEmailSignUp`.
- Privacidade: o hash da senha no registro de tratamento, a exportação lista a conta de senha como
  `email` (sem o hash), a exclusão a apaga, a manutenção apaga as janelas velhas do rate limit do
  Better Auth, e os Termos e a política sobem para 2026-11-16 (novo aceite no onboarding).
- ADR 0036 e nota de revisão na ADR 0019.

## Capabilities

### Modified Capabilities

- `authentication`: e-mail e senha, contas separadas por método, rate limit das rotas de e-mail e
  os métodos de entrada públicos.
- `privacy`: exportação e exclusão com a conta de senha e retenção do rate limit do Better Auth.
- `web-data`: chamadas de e-mail e senha e métodos de entrada no cliente do web.

## Impact

- `apps/api`: `adapters/out/auth/better-auth.ts`, porta `AuthGateway` (`methods`), rota
  `routes/auth-providers.ts`, repositório de conta (exportação e expurgo) e testes (unidade e
  integração com o callback do GitHub simulado).
- `packages/shared`: `contracts/auth.ts` e `legal/versions.ts`.
- `apps/web`: `src/lib/api/{auth,queries,hooks}.ts`, cliente gerado, `openapi.json`, catálogos
  (`legal`) e o e2e `email-auth.spec.ts`.
- Docs: ADR 0036, ADR 0019, `backend.md`, `frontend.md`, `ropa.md` e `status.md`.
- Sem migração: a coluna `auth.account.password` já existia. Sem dependência nova.
