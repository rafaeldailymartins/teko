# Proposal

## Why

O primeiro deploy de produção da F7 parou no ensaio do Neon: a migração `*_constraints-grants` não
conseguiu gravar os timeouts do `teko_app` (`ALTER ROLE ... SET`), porque o role foi criado pela API
do Neon e o owner não tem `ADMIN` sobre ele. Pior: todo role criado pela API ou pelo Console vira
membro do `neon_superuser` (lê e escreve qualquer tabela, cria roles e bancos, ignora RLS), o oposto
do privilégio mínimo. O `teko_app` da produção e o `teko_watch` dos dois projetos estão assim (ADR
0040).

## What Changes

- **`scripts/neon-roles.ts` cria os roles por SQL, como o owner** (`CREATE ROLE ... WITH LOGIN
  PASSWORD`), com a senha gerada pelo script. Role da API é recriado (o owner revoga o que
  concedeu, a API do Neon apaga, o owner recria); role certo é mantido, ou tem a senha trocada com
  `--reset-password` ou quando falta um segredo.
- A URL `-pooler` vai pelo stdin para os segredos dos GitHub Environments e, no `teko_app`, para a
  `DATABASE_URL` Sensitive do projeto Vercel do ambiente.
- **Migração `*_regrant-login-roles`:** reaplica grants e timeouts a role recriado depois das
  migrações que o configuravam (idempotente).
- `pg` e `@types/pg` entram nas devDependencies da raiz (catálogo) para o script.

## Capabilities

### Modified Capabilities

- `corpus-schema`: o requisito "Credenciais fora do repositório" passa de "criados pela API do Neon,
  com senha gerada pelo Neon" para "criados por SQL pelo owner, fora do `neon_superuser`".

## Impact

- `scripts/neon-roles.ts` e `scripts/neon-roles.test.ts`; `package.json` e `pnpm-lock.yaml` da
  raiz.
- `apps/api/drizzle/migrations/*_regrant-login-roles`.
- Docs: ADR 0040, runbook `neon-roles.md`, `docs/status.md`.
- Operação: o mantenedor roda o script nos dois projetos antes do próximo release (recria
  `teko_app` e `teko_watch` da produção e `teko_watch` do staging).
- Fase: F7 (bloqueia o primeiro deploy de produção).
