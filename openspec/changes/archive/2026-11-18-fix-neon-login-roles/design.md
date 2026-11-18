# Design

## Context

Os roles de login (`teko_app`, `teko_watch`) eram criados pela API do Neon pelo
`scripts/neon-roles.ts`, e as migrações concedem os privilégios e gravam os timeouts. No Postgres
16+, alterar um role exige `ADMIN OPTION` sobre ele, que só o criador por SQL ganha; e o Neon põe
todo role da API ou do Console no `neon_superuser`. O ensaio do primeiro release de produção
(`neon-rehearsal.yml`) falhou por isso.

## Goals / Non-Goals

**Goals:** roles de login fora do `neon_superuser`, com o owner capaz de configurá-los; nenhuma
senha em arquivo, terminal ou repositório; um único comando por projeto para corrigir os roles
existentes e gravar todos os destinos da URL.

**Non-Goals:** mudar os privilégios concedidos pelas migrações, o owner usado pelo
`drizzle-kit migrate` ou o fluxo do deploy.

## Decisions

- **Estado lido no banco, não na API.** O script conecta como `neondb_owner` (URL direta da
  `connection_uri` da API) e lê, por role, se é membro do `neon_superuser` e se o owner tem
  `ADMIN`. Os dois sinais separam o role da API do criado por SQL.
- **Recriar em vez de corrigir.** O owner não consegue tirar um role do `neon_superuser` (não tem
  `ADMIN` sobre ele) nem apagá-lo (o `DROP ROLE` também exige `ADMIN`). Então o owner revoga o que
  concedeu (tabelas e colunas, sequências, esquemas, default privileges e o banco; a revogação na
  tabela leva junto a das colunas), a API do Neon apaga o role (operação assíncrona: o script espera
  ele sumir do `pg_roles`) e o owner o recria.
- **Senha gerada pelo script.** O Neon não aceita hash em `CREATE ROLE` por SQL e exige 60 bits; a
  senha tem 40 caracteres de `[A-Za-z0-9_-]` (as quatro classes, sem três iguais seguidos), segura
  em URL e em literal SQL. Ela só existe na hora: completar um segredo faltando troca a senha e
  regrava todos os destinos do role.
- **URL a partir da do owner.** A `-pooler` do owner, com usuário e senha trocados, mantém host,
  banco e parâmetros (`sslmode`, `channel_binding`).
- **`DATABASE_URL` da Vercel pelo mesmo script.** A Sensitive é gravada pelo stdin do Vercel CLI
  isolado (`vercel env add DATABASE_URL production --sensitive --force --project --scope`), com os
  IDs das variáveis do environment do GitHub e o login do mantenedor. Antes ela era copiada à mão.
- **Migração de regrant.** O bloco de grants das migrações só age sobre roles que existem; um role
  recriado depois perde o que a migração deu. A `*_regrant-login-roles` repete o bloco (com o
  `gap_entries` do `teko_watch`), idempotente.

## Risks / Trade-offs

- Entre o script e o próximo `drizzle-kit migrate`, o role recriado não tem acesso. Na produção não
  há tráfego ainda; no staging, o `teko_watch` fica sem acesso até o deploy desta mudança (o
  `mark-coverage` de um run nesse intervalo falha e passa no seguinte).
- A senha trafega em texto até o Postgres (TLS obrigatório no Neon).

## Fontes (Context7)

- `/websites/neon`: roles da API e do Console no `neon_superuser` (`CREATEROLE`, `CREATEDB`,
  `BYPASSRLS`, `pg_read_all_data`, `pg_write_all_data`); roles por SQL fora dele; senha em texto,
  60 bits, sem hash.
- `/websites/vercel`: `vercel env add` com `--sensitive`, `--force`, `--project` e o valor pelo
  stdin.
