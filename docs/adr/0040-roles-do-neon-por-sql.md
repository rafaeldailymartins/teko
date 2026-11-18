---

status: accepted
date: 2026-11-18
decision-makers: Rafael Daily Santos Martins
---

# 0040 — Roles de login do Neon criados por SQL pelo owner

## Contexto e problema

O `scripts/neon-roles.ts` criava `teko_app` e `teko_watch` pela API do Neon, com senha gerada pelo
Neon (requisito "Credenciais fora do repositório" da spec `corpus-schema`). O primeiro deploy de
produção da F7 (run 44406690135) parou no ensaio da migração: a `*_constraints-grants` roda
`ALTER ROLE teko_app SET statement_timeout`, e o Postgres recusou com "Only roles with the
CREATEROLE attribute and the ADMIN option on role "teko_app" may alter this role".

A causa é dupla. No Postgres 16+, alterar um role exige `ADMIN OPTION` sobre ele, e só quem o cria
por SQL a ganha; o owner (`neondb_owner`) não tem `ADMIN` sobre um role criado pelo control plane.
E todo role criado pela API ou pelo Console do Neon vira membro do `neon_superuser`, com
`CREATEROLE`, `CREATEDB`, `BYPASSRLS`, `pg_read_all_data` e `pg_write_all_data`: o `teko_app` da
produção e o `teko_watch` dos dois projetos liam e escreviam qualquer tabela, o oposto do privilégio
mínimo do desenho. No staging a migração tinha passado porque o `teko_app` de lá foi criado por SQL
pelo mantenedor no spike F1 (d) ([ADR 0003](0003-f1-spikes.md)).

## Fatores de decisão

- Privilégio mínimo: o `teko_app` só lê `corpus` e escreve em `app` e `auth`, sem DDL; o
  `teko_watch` só atualiza colunas de `corpus.coverage`.
- Os timeouts de 5 s ficam no role, porque o PgBouncer do `-pooler` não aceita `SET` de sessão
  (spike F1 (d)).
- Nenhuma senha passa por arquivo, terminal, chat ou repositório.

## Opções consideradas

- **Manter a API do Neon** e tirar o `ALTER ROLE` da migração: os roles continuariam no
  `neon_superuser`, e o owner não consegue revogar essa associação (não tem `ADMIN` sobre o
  `neon_superuser`).
- **Criar por SQL como owner**, com a senha gerada pelo script.

## Decisão

Opção escolhida: **criar por SQL como owner**. O `neon-roles.ts` conecta como `neondb_owner` (URL
direta pedida à API do Neon com a API key do projeto), lê o estado de cada role
(`neon_superuser` e `ADMIN` do owner) e:

- cria o role ausente com `CREATE ROLE ... WITH LOGIN PASSWORD`;
- recria o role da API: o owner revoga o que concedeu, a API do Neon apaga, o owner recria;
- troca a senha (`ALTER ROLE ... PASSWORD`) com `--reset-password` ou quando falta um segredo, já
  que a senha só existe no momento em que é gerada.

A senha tem 40 caracteres aleatórios (o Neon exige 60 bits e não aceita hash) e vai ao Postgres por
TLS, à URL `-pooler` montada a partir da do owner e, pelo stdin, ao `gh secret set` e, no
`teko_app`, ao `vercel env add DATABASE_URL --sensitive` (Vercel CLI isolado, com o login do
mantenedor). A migração `*_regrant-login-roles` reaplica grants e timeouts a role recriado depois
das migrações que o configuravam.

### Consequências

- Bom, porque os roles de login nascem só com o que as migrações lhes dão, e o owner consegue
  configurá-los.
- Bom, porque a `DATABASE_URL` da Vercel passa a ser gravada pelo mesmo script, sem o valor passar
  pelo mantenedor.
- Ruim, porque a senha deixa de ser gerada pelo Neon e passa a existir, por um instante, no processo
  do script; e o role recriado fica sem acesso até o próximo `drizzle-kit migrate`.

### Confirmação

- `scripts/neon-roles.test.ts`: plano (`create`, `recreate`, `reset`, `keep`), senha e SQL.
- Simulação no Postgres 18 (`pgvector/pgvector:0.8.6-pg18`): role "da API" (membro do
  `neon_superuser`) recusa o `ALTER ROLE` do owner; depois do revoke, do drop e do `CREATE ROLE`
  pelo owner, o `ALTER ROLE` e os grants passam, e o role sai sem `CREATEROLE`, `CREATEDB`,
  `BYPASSRLS` e fora do `neon_superuser`.
- O ensaio do Neon (`neon-rehearsal.yml`) passa no release seguinte.

## Mais informações

- Mudança OpenSpec `fix-neon-login-roles`.
- Fontes Context7 consultadas em 2026-11-18: `/websites/neon` (roles da API e do Console no
  `neon_superuser`; roles por SQL sem ele; senha em texto, 60 bits, sem hash) e `/websites/vercel`
  (`vercel env add` pelo stdin, `--sensitive`, `--force`, `--project`).
- Runbook: [`neon-roles.md`](../runbooks/neon-roles.md).
