# Tasks

## 1. Script

- [x] 1.1 `scripts/neon-roles.ts` lê o estado no banco como owner e cria, recria ou troca a senha
  por SQL; a URL vai para os segredos e, no `teko_app`, para a `DATABASE_URL` da Vercel (verificar:
  `node --test scripts/neon-roles.test.ts`)
- [x] 1.2 `pg` e `@types/pg` nas devDependencies da raiz, pelo catálogo (verificar: `pnpm install`,
  `knip` e `check-lockfile`)
- [x] 1.3 Simulação no Postgres 18: role "da API" recusa o `ALTER ROLE`; revoke, drop e
  `CREATE ROLE` pelo owner deixam o role fora do `neon_superuser` e a migração passa

## 2. Migração

- [x] 2.1 `*_regrant-login-roles` reaplica grants e timeouts (verificar: `pnpm test:integration` da
  API com a migração nova)

## 3. Documentos

- [x] 3.1 ADR 0040, runbook `neon-roles.md` e `docs/status.md` (verificar: revisão do diff)

## 4. Specs

- [x] 4.1 Delta de `corpus-schema` (verificar: `pnpm spec:validate`)
