---

status: accepted
date: 2026-11-14
decision-makers: Rafael Daily Santos Martins
---

# 0019 — Login por OAuth (GitHub e Google) e passkey, com o Better Auth

## Contexto e problema

Sem domínio próprio não há remetente de e-mail confiável: login por e-mail e senha ou por link
mágico fica fora. Web e API estão na mesma origem (ADR 0029), então a sessão pode ser um cookie
first-party. A API roda em várias instâncias da Fluid compute, sem estado em memória.

## Decisão

1. **Better Auth 1.7** com o adapter do Drizzle (`/relations-v2`) e o plugin de passkey, na mesma
   linha e com proveniência. Primeiro login por OAuth (GitHub ou Google); a passkey é registrada
   depois, com sessão ativa. Sem e-mail e senha.
2. **Schema `auth` escrito à mão** (o CLI do Better Auth exigiria `npx` de um pacote fora do
   lockfile), conferido por teste contra o `getAuthTables` do próprio Better Auth. IDs `uuid`
   (`generateId: 'uuid'`, `uuidv7()` como default no banco): as FKs do schema `app` são `uuid`.
3. **Sessão:** 7 dias, renovada a cada dia de uso, `cookieCache` de 5 min; cookies `teko` (produção)
   ou `teko-stg`, `HttpOnly`, `SameSite=Lax` e `__Secure-` em https. Rate limit do Better Auth em
   banco. Telemetria desligada, e as variáveis que a ligariam derrubam o boot.
4. **Guarda de `Origin` própria em todo `/api/*`**, inclusive `/api/auth/*`: o Better Auth só
   confere a origem quando a requisição traz cookie.
5. **Onboarding** antes do uso: 18+, versão vigente dos Termos (`TERMS_VERSION`) e país de
   residência.
6. **Login local e e2e sem OAuth:** `seed:dev-session` grava usuário e sessão direto no banco e
   assina o cookie como o Better Auth (só development e ci).

## Consequências

- Uma sessão revogada continua válida no cookie por até 5 min; as rotas de DSR leem a sessão do
  banco, e a janela fica no registro de tratamento.
- Os OAuth apps de staging e produção e as env vars Sensitive (`BETTER_AUTH_SECRET`,
  `GITHUB_CLIENT_*`, `GOOGLE_CLIENT_*`) são criados pelo mantenedor; o boot de staging e produção
  com banco falha sem eles.
- Passkeys valem por host (`rpID`): no corte para o Plano B, os usuários registram de novo.
