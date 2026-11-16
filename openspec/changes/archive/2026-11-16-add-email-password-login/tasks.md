# Tasks

## 1. API

- [x] 1.1 Contrato em `@teko/shared/contracts` (`AuthMethod`, política de senha, cadastro e entrada)
- [x] 1.2 `emailAndPassword`, gancho do cadastro, `accountLinking`, `disabledPaths` e rate limit
- [x] 1.3 Porta `AuthGateway.methods` e `GET /api/v1/auth/providers`
- [x] 1.4 Exportação com a conta `email` e expurgo do `auth.rate_limit`
- [x] 1.5 Testes unitários e de integração (cadastro, entrada, erro genérico, rate limit, não
  vinculação, DSR, métodos de entrada)

## 2. Web

- [x] 2.1 OpenAPI e cliente regenerados
- [x] 2.2 `signUpWithEmail`, `signInWithEmail` e `EmailAuthError` em `src/lib/api/auth.ts`
- [x] 2.3 `useAuthProviders`, `useEmailSignIn` e `useEmailSignUp`
- [x] 2.4 E2E `email-auth.spec.ts` pela API

## 3. Privacidade e docs

- [x] 3.1 Termos e política (`legal`) e `TERMS_VERSION`/`PRIVACY_POLICY_VERSION` em 2026-11-16
- [x] 3.2 `ropa.md`, `backend.md`, `frontend.md` e `status.md`
- [x] 3.3 ADR 0036 e nota de revisão na ADR 0019
