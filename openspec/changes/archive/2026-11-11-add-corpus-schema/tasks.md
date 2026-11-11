# Tasks

## 1. Dependências e driver

- [x] 1.1 Conferir proveniência dos candidatos no registry (`pg`, `postgres`, `@neondatabase/serverless`, Testcontainers, Drizzle) e escolher o `pg` 8.23.1; registrar as exceções no ADR 0002 — `npm view <pacote> dist.attestations`
- [x] 1.2 Catálogo com `drizzle-orm`/`drizzle-kit` 1.0.0-rc.5, `pg`, `@types/pg`, Testcontainers 12.2.1 e `yaml` 2.9.1; `allowBuilds` negando `ssh2`, `cpu-features`, `protobufjs` e `esbuild`; overrides de `glob` e `basic-ftp` — `pnpm install --frozen-lockfile` e `pnpm audit --audit-level low` sem achados

## 2. Schema e migrações

- [x] 2.1 Schema Drizzle de `corpus` e `app` com os tipos custom (`daterange`, `datemultirange`, `tsvector`) — `pnpm --filter @teko/api typecheck`
- [x] 2.2 Migrações (extensões e `immutable_unaccent`; tabelas geradas; `pv_no_overlap` e grants) aplicadas no pgvector 0.8.6 + PG 18 — `test/integration/db/roles-and-grants.test.ts`
- [x] 2.3 Teste de privilégio mínimo: timeouts de 5 s no `teko_app`, `permission denied` em DDL, corpus só leitura, `teko_watch` restrito — `pnpm --filter @teko/api test:integration`
- [x] 2.4 `migration-guard` no `ci.yml` com testes (`bash .github/scripts/migration-guard.test.sh`, 8 casos)

## 3. Escrita e fixture

- [x] 3.1 `CorpusWriter` em lotes, `WriteCorpus`, invariante de fonte publicada — `test/integration/corpus/corpus-writer.test.ts`
- [x] 3.2 Fixture única com textos reais (9 documentos, 1.569 redações, procedência no README da fixture) e `cli seed-fixtures` — `pnpm --filter @teko/api seed:fixtures`
- [x] 3.3 `FakeEmbeddingAdapter` (strict), adapter Workers AI e `pnpm fixtures:embed` (1.614 vetores BGE-M3, ~410 neurons no total das rodadas) — testes unitários dos adapters
- [x] 3.4 `DATABASE_URL`, pool `pg` com `attachDatabasePool` na Vercel e variáveis de embeddings no boot — testes de `config/env.ts`, `config/platform.ts` e `composition-root.ts`

## 4. Roles do Neon

- [x] 4.1 `scripts/neon-roles.ts` (cria os roles e grava as URLs pelo `gh secret set` via stdin) com testes do planejamento — `pnpm test:scripts`
- [x] 4.2 Runbook `docs/runbooks/neon-roles.md` com a ordem (roles antes da primeira migração) e os destinos dos segredos
