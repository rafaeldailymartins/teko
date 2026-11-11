# Design

## Context

O plano fixa o modelo de dados (seção "Modelo de dados"), a migração custom inicial e os roles.
O spike F1 (d) mostrou que o PgBouncer do Neon não aceita `statement_timeout` na conexão (os
timeouts ficam no role) e deixou para a F2 a escolha do driver, porque o `pg` nunca teve
proveniência e a regra do repositório a exige para dependência nova.

## Goals / Non-Goals

**Goals:**

- Schema e migrações reproduzíveis, com os mesmos papéis do Neon nos testes (owner, `teko_app`,
  `teko_watch`).
- Escrita do corpus atômica e rápida o bastante para a ingestão da F3 reaproveitar.
- Nenhuma senha no repositório nem no terminal.

**Non-Goals:**

- Migração de dados de produção, `promote-corpus` e snapshot (F3).
- Tabelas do Better Auth (F4).

## Decisions

- **Driver `pg` 8.23.1, como exceção de proveniência.** Nenhum driver Postgres do npm tem
  proveniência (`pg`, `postgres` 3.4.9/4.0.0 e `@neondatabase/serverless` 1.2.0 conferidos no
  registry em 2026-11-11). O `pg` é o único com `attachDatabasePool` documentado pela Vercel e
  com `drizzle-orm/node-postgres`; o `@neondatabase/serverless` exigiria WebSocket ou HTTP e não
  roda contra o Postgres local e o da stack de CI. O `trustPolicy: no-downgrade` aceita pacote que
  nunca teve proveniência; a exceção fica registrada no ADR 0002. Testcontainers 12.2.1 e `yaml`
  2.9.1 (já na árvore pelo promptfoo) entram pelo mesmo motivo, só como devDependencies.
- **Drizzle 1.0 RC com `snakeCase.schema`** e sem `relations`: as consultas são SQL explícito (a
  busca) ou o query builder (escrita). Tipos sem coluna nativa (`daterange`, `datemultirange`,
  `tsvector`) são `customType` com a conversão do `@teko/shared/vigencia`.
- **Três migrações**: extensões + `immutable_unaccent` + schema `auth` (custom, antes das tabelas,
  porque o `tsv` gerado depende da função), tabelas (geradas) e `pv_no_overlap` + grants (custom).
  Sem `DROP ... IF EXISTS` na custom: o drizzle-kit aplica cada migração uma vez, e o
  `migration-guard` barra DROP sem o label `contract`.
- **Roles antes da primeira migração.** O bloco de grants só age sobre roles existentes; o
  `scripts/neon-roles.ts` cria `teko_app` e `teko_watch` pela API do Neon e grava as URLs `-pooler`
  nos environments (`staging`, `maintenance`, `corpus-watch`) pelo stdin do `gh secret set`, sem
  imprimir. O `teko_app` do staging já existe desde o spike F1 (d).
- **`teko_watch` com `UPDATE (verified_at, gaps, gap_reason)`.** O plano concede só
  `verified_at` e `gap_reason`; a lacuna precisa de um intervalo para o `CheckCoverage` subtrair
  (`coverage.gaps`, `datemultirange`), e o `mark-coverage` a grava junto com o motivo.
- **Writer em lotes de 500 com IDs pedidos ao banco** (`SELECT uuidv7() FROM generate_series`):
  os filhos sabem o ID dos pais sem depender da ordem do `RETURNING`. A semente da fixture caiu de
  ~80 s para ~5 s por banco de teste.
- **Testes com um template migrado por arquivo** (`CREATE DATABASE ... TEMPLATE teko_migrated`):
  arquivos de integração rodam em paralelo sem `restoreSnapshot` entre eles. O superusuário cria
  as extensões antes das migrações, como o Neon faz com o `neon_superuser`, e o owner recebe
  `CREATEROLE` + `ADMIN OPTION` sobre os roles (exigência do PG 16+ para `ALTER ROLE ... SET`).
- **`FakeEmbeddingAdapter` com vetores reais.** A fixture `embeddings.json.gz` guarda vetores
  BGE-M3 do Workers AI em float16 (a precisão do `halfvec`), em base64, por hash do texto de
  embedding. Em modo strict, um texto fora da fixture falha em vez de virar vetor inventado.
- **Lotes de embedding por tokens.** O BGE-M3 recusa contexto acima de 60 mil tokens contando o
  lote preenchido até o texto mais longo (HTTP 400, código 8007, medido na geração da fixture); o
  lote é limitado a 50 itens e 48 mil tokens estimados (`ceil(chars/3)`), com textos ordenados
  por tamanho.

## Risks / Trade-offs

- `pg` e Testcontainers sem proveniência: mitigados pelo lockfile com integridade, pela
  auditoria (`pnpm audit`, osv-scanner) e pelo `minimumReleaseAge` de 7 dias.
- O RC do Drizzle pode mudar o formato das migrações antes do 1.0. Mitigação: versão exata no
  catálogo e o Dependabot com cooldown.

## Fontes Context7

| Biblioteca                | ID Context7                                               | Versão conferida  | Tópicos                                                                                                                   |
| ------------------------- | --------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Drizzle ORM / drizzle-kit | `/websites/rqbv2_drizzle-orm-fe_pages_dev`                | 1.0.0-rc.5        | `pgSchema`, `halfvec`, colunas geradas com `tsvector`, índices `using`, `generate --custom`, `migrate` do `node-postgres` |
| node-postgres             | `/brianc/node-postgres`                                   | 8.23.1            | opções do `Pool`, evento `error` de clientes ociosos                                                                      |
| Testcontainers            | `/testcontainers/testcontainers-node/v12.2.0`             | 12.2.1            | `PostgreSqlContainer`, snapshots, `withTmpFs`, globalSetup do Vitest                                                      |
| Neon API                  | `/websites/neon`                                          | API v2            | criar role no branch, `reveal_password`, `connection_uri` com `pooled`                                                    |
| Workers AI                | `/llmstxt/developers_cloudflare_workers-ai_llms-full_txt` | `@cf/baai/bge-m3` | REST `ai/run`, `text: string[]`, `shape` e `data`                                                                         |
| pgvector                  | `/pgvector/pgvector`                                      | 0.8.6             | `halfvec_cosine_ops`, HNSW `m`/`ef_construction`                                                                          |

`@vercel/functions` 3.7.6 (`attachDatabasePool`) foi conferido nos tipos do próprio pacote
instalado: a versão é fixa por proveniência (ADR 0002) e não tem página por versão no Context7.
