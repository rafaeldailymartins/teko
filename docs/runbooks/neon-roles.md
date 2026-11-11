# Runbook: roles do Neon (`teko_app` e `teko_watch`)

Os roles de login do Tekó são criados pela API do Neon, com senha gerada pelo Neon, e as URLs vão
direto para os GitHub Environments. Nenhuma senha passa por arquivo, terminal, chat ou repositório
(plano: "Roles e privilégio mínimo"; [ADR 0009](../adr/0009-vigencia-bitemporal.md)).

| Role                   | Uso                                                | Privilégios (da migração `*_constraints-grants`)                                                                              |
| ---------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| owner (`neondb_owner`) | `drizzle-kit migrate`, ingestão, `promote-corpus`  | dono do banco                                                                                                                 |
| `teko_app`             | runtime na Vercel (`-pooler`) e manutenção semanal | lê `corpus`; lê e escreve `app` e `auth`; `statement_timeout` e `idle_in_transaction_session_timeout` de 5 s no role; sem DDL |
| `teko_watch`           | job `mark-coverage` do `source-watch.yml`          | lê `corpus.coverage`; atualiza `verified_at`, `gaps` e `gap_reason`                                                           |

## Ordem obrigatória

O bloco de grants da migração só age sobre roles que já existem. Em cada projeto Neon
(`teko-staging`, `teko-prod`), **crie os roles antes da primeira migração** (o primeiro
`drizzle-kit migrate` é do `deploy-api.yml`, na F7). Se um role nascer depois, a migração não o
configura: rode de novo o bloco `DO $$ ... $$` da migração `*_constraints-grants` como owner (ele é
idempotente) ou crie uma migração nova com o mesmo bloco.

No `teko-staging`, o `teko_app` já existe desde o spike F1 (d), com os timeouts gravados; falta o
`teko_watch`.

## Como rodar

Na máquina do mantenedor, com o `gh` autenticado no repositório e uma API key **do projeto**
(Neon Console → projeto → Settings → API keys). O script pede a key no terminal, sem eco e fora do
histórico do shell; o ID do projeto (Neon Console → projeto → Settings) vai em `--project`:

```bash
node scripts/neon-roles.ts --env staging --project <id-do-projeto> --dry-run
```

```bash
node scripts/neon-roles.ts --env staging --project <id-do-projeto>
```

O `--dry-run` só mostra o plano (`create`, `keep` ou `reset` por role e os segredos que faltam). Sem
ele, o script cria os roles que faltam no branch padrão, pede ao Neon a URL `-pooler` de cada role
(`GET /projects/{id}/connection_uri`) e grava pelo stdin do `gh secret set`:

| `--env`      | Role         | Segredo                  | Environment              |
| ------------ | ------------ | ------------------------ | ------------------------ |
| `staging`    | `teko_app`   | `NEON_STAGING_APP_URL`   | `staging`, `maintenance` |
| `staging`    | `teko_watch` | `NEON_STAGING_WATCH_URL` | `corpus-watch`           |
| `production` | `teko_app`   | `NEON_PROD_APP_URL`      | `maintenance`            |
| `production` | `teko_watch` | `NEON_PROD_WATCH_URL`    | `corpus-watch`           |

Um role que já existe não tem a senha trocada; só os segredos que faltam são gravados. Para
rotacionar, use `--reset-password`: a senha muda no Neon e todos os destinos do role são
regravados (as conexões abertas com a senha antiga caem).

A env var Sensitive `DATABASE_URL` do projeto Vercel (o `teko_app` pelo `-pooler`) entra pelo
`vercel-env-sync` na F7.

## Conferência

Depois da primeira migração do projeto, o teste de integração `roles-and-grants` descreve o que
precisa valer; no Neon, como `teko_app` pelo `-pooler`:

```sql
SHOW statement_timeout;                 -- 5s
DROP TABLE corpus.chunks;               -- ERROR: permission denied
```
