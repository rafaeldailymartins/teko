# Proposal

## Why

A busca filtrada por vigência e as citações precisam de um modelo de dados que guarde, para cada
dispositivo, todas as redações com o intervalo em que valeram, quais versões de documento as
contêm e o que está coberto. O runtime precisa enxergar isso com privilégio mínimo, pelo pooler do
Neon. É a segunda mudança da F2.

## What Changes

- Schema canônico em Drizzle 1.0 RC (`apps/api/src/adapters/out/persistence/drizzle/schema`):
  schemas `corpus` e `app` (e `auth` vazio, para o Better Auth da F4), IDs `uuidv7()`, colunas de
  vigência em `daterange`/`datemultirange`, `halfvec(1024)`, `tsv` gerado com
  `immutable_unaccent` e os índices GIN, HNSW, GiST e trigram.
- Migrações em `apps/api/drizzle/migrations`: extensões e `immutable_unaccent` (custom), tabelas
  (geradas pelo drizzle-kit) e `pv_no_overlap` + grants idempotentes de `teko_app` e
  `teko_watch` (custom).
- Driver `pg` 8.23.1 com pool por instância e `attachDatabasePool` na Vercel; `DATABASE_URL`,
  `DATABASE_MAX_CONNECTIONS` e as variáveis de embeddings validadas no boot.
- `CorpusWriter` transacional em lotes, caso de uso `WriteCorpus`, a fixture única
  (`apps/api/test/fixtures/corpus`, textos reais das fontes oficiais), `cli seed-fixtures`
  (`dist/cli.mjs`), `FakeEmbeddingAdapter` (strict nas evals), adapter Workers AI (BGE-M3) e
  `pnpm fixtures:embed`.
- `scripts/neon-roles.ts` (roles pela API do Neon, URLs direto para os GitHub Environments) e o
  runbook `docs/runbooks/neon-roles.md`.
- Banco de teste com Testcontainers (pgvector 0.8.6 + PG 18, roles iguais aos do Neon, template
  migrado por arquivo) e o `migration-guard` no `ci.yml`.
- Fora de escopo: rodar as migrações e criar os roles nos projetos Neon reais (o primeiro
  `drizzle-kit migrate` é do `deploy-api.yml`, F7; os roles são criados pelo mantenedor com o
  script antes disso), tabelas `auth.*` (F4) e a ingestão real (F3).

## Capabilities

### New Capabilities

- `corpus-schema`: modelo de dados bitemporal do corpus, migrações e privilégio mínimo.

### Modified Capabilities

- `quality-gates`: migrações passam pelo `migration-guard`.

## Impact

- ADR 0002 (exceções de proveniência: `pg`, Testcontainers, `yaml` e overrides de `glob` e
  `basic-ftp`), ADR 0009 (vigência bitemporal), plano (seção Modelo de dados: coluna
  `coverage.gaps`).
- Novas dependências no catálogo: `drizzle-orm`/`drizzle-kit` 1.0.0-rc.5, `pg` 8.23.1,
  `@types/pg` 8.23.1, `testcontainers`/`@testcontainers/postgresql` 12.2.1, `yaml` 2.9.1.
