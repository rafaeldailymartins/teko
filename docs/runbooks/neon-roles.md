# Runbook: roles do Neon (`teko_app` e `teko_watch`)

Os roles de login do Tekó são criados **por SQL pelo owner** (`neondb_owner`), com senha gerada
pelo script, e as URLs vão direto para os GitHub Environments e para a `DATABASE_URL` da Vercel.
Nenhuma senha passa por arquivo, terminal, chat ou repositório
([ADR 0040](../adr/0040-roles-do-neon-por-sql.md)).

**Nunca crie um role de login pela API, pelo Console ou pela CLI do Neon:** o Neon o põe no
`neon_superuser` (lê e escreve qualquer tabela, cria roles e bancos, ignora RLS), e o owner não
consegue configurá-lo (`ALTER ROLE ... SET` exige `ADMIN`, que só quem cria por SQL ganha).

| Role                   | Uso                                                | Privilégios (das migrações `*_constraints-grants` e `*_regrant-login-roles`)                                                  |
| ---------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| owner (`neondb_owner`) | `drizzle-kit migrate`, ingestão, `promote-corpus`  | dono do banco                                                                                                                 |
| `teko_app`             | runtime na Vercel (`-pooler`) e manutenção semanal | lê `corpus`; lê e escreve `app` e `auth`; `statement_timeout` e `idle_in_transaction_session_timeout` de 5 s no role; sem DDL |
| `teko_watch`           | job `mark-coverage` do `source-watch.yml`          | lê `corpus.coverage`; atualiza `verified_at`, `gaps`, `gap_reason` e `gap_entries`                                            |

## Ordem

O bloco de grants das migrações só age sobre roles que já existem. Role criado ou recriado depois de
uma migração recebe os grants e os timeouts no próximo `drizzle-kit migrate` (a
`*_regrant-login-roles` repete o bloco); até lá, ele conecta mas não lê nada.

Estado em 2026-11-18: o `teko_app` do `teko-staging` foi criado por SQL no spike F1 (d) e está
certo. O `teko_watch` do staging e os dois roles do `teko-prod` foram criados pela API e precisam
ser recriados com o script abaixo, antes do primeiro release de produção.

## Como rodar

Na máquina do mantenedor, com:

- o `gh` autenticado no repositório;
- o Vercel CLI isolado instalado e logado (`pnpm --dir tools/vercel-cli install --frozen-lockfile`;
  o login é o de sempre do mantenedor);
- uma API key **do projeto** (Neon Console → projeto → Settings → API keys). O script a pede no
  terminal, sem eco e fora do histórico do shell; o ID do projeto (Neon Console → projeto →
  Settings) vai em `--project`.

```bash
node scripts/neon-roles.ts --env staging --project <id-do-projeto> --dry-run
```

```bash
node scripts/neon-roles.ts --env staging --project <id-do-projeto>
```

O script conecta como owner (URL direta pedida à API do Neon) e decide, por role:

| Ação       | Quando                                                                      | O que faz                                                                   |
| ---------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `create`   | o role não existe                                                           | `CREATE ROLE ... WITH LOGIN PASSWORD` como owner                            |
| `recreate` | o role é membro do `neon_superuser` ou o owner não tem `ADMIN` sobre ele    | o owner revoga o que concedeu, a API do Neon apaga o role, o owner o recria |
| `reset`    | `--reset-password`, ou falta um segredo (a senha só existe quando é gerada) | `ALTER ROLE ... WITH PASSWORD` como owner                                   |
| `keep`     | criado por SQL, com os segredos gravados                                    | nada                                                                        |

O `--dry-run` só mostra o plano. Sem ele, cada role que muda tem a senha gerada pelo script (40
caracteres aleatórios) e a URL `-pooler` montada a partir da do owner, que vai pelo stdin para:

| `--env`      | Role         | Segredo                  | Environment              | Vercel                             |
| ------------ | ------------ | ------------------------ | ------------------------ | ---------------------------------- |
| `staging`    | `teko_app`   | `NEON_STAGING_APP_URL`   | `staging`, `maintenance` | `DATABASE_URL` do `tekoia-staging` |
| `staging`    | `teko_watch` | `NEON_STAGING_WATCH_URL` | `corpus-watch`           | —                                  |
| `production` | `teko_app`   | `NEON_PROD_APP_URL`      | `maintenance`            | `DATABASE_URL` do `tekoia`         |
| `production` | `teko_watch` | `NEON_PROD_WATCH_URL`    | `corpus-watch`           | —                                  |

A `DATABASE_URL` é gravada como Sensitive no ambiente Production do projeto Vercel (os IDs vêm das
variáveis `VERCEL_PROJECT_ID` e `VERCEL_ORG_ID` do environment do GitHub). Ela só vale numa
deployment nova: depois de trocar a senha do `teko_app`, rode o deploy do ambiente. Para rotacionar,
use `--reset-password` (as conexões abertas com a senha antiga caem).

## Conferência

Depois da migração seguinte, o teste de integração `roles-and-grants` descreve o que precisa valer;
no Neon, como owner:

```sql
SELECT rolname, rolcreaterole, rolcreatedb, rolbypassrls,
       pg_has_role(oid, 'neon_superuser', 'MEMBER') AS neon_superuser
FROM pg_roles WHERE rolname IN ('teko_app', 'teko_watch');   -- tudo false
```

E como `teko_app` pelo `-pooler`:

```sql
SHOW statement_timeout;                 -- 5s
DROP TABLE corpus.chunks;               -- ERROR: permission denied
```
