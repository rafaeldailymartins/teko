# Tasks

## 1. Schema e portas

- [x] 1.1 Migração `ingestion-pipeline` (gerada pelo `db:generate`): `ingestion_runs.neurons`; `review_queue.stable_key`, `note_hash`, `provision_version_id`, `document_version_id` e o índice único parcial de itens abertos; só expand, grants inalterados — `test/integration/db/roles-and-grants.test.ts` e `schema.test.ts`
- [x] 1.2 Portas `corpus-ingestion-repository`, `ingestion-run-repository`, `embedding-cache`, `snapshot-repository` (com o schema zod do manifesto) e `database-usage` — `pnpm --filter @teko/api typecheck`

## 2. Casos de uso e serviços

- [x] 2.1 `neuron-budget` (estimativa, `NeuronMeter`, orçamento por dia de `America/Sao_Paulo`) — `src/application/services/neuron-budget.test.ts`
- [x] 2.2 `embed-pending` (cache como checkpoint, lotes, primeiro lote sozinho, concorrência 2, backoff, dimensão 1.024, `budget_exhausted`) — `src/application/use-cases/embed-pending.test.ts`
- [x] 2.3 `ingest-document-version` (`planReconciliation`, transação por versão, recorte bitemporal, fila de revisão, invariante de fonte publicada, guarda de tamanho) — `src/application/use-cases/ingest-document-version.test.ts`
- [x] 2.4 `ingestion-run` (`--bulk` só no staging, CU-s do Neon, `db_bytes`) e `refresh-coverage` — `src/application/use-cases/ingestion-run.test.ts`
- [x] 2.5 `export-snapshot` (ordem de FK, manifesto por último, retenção de 3) e `promote-snapshot` (migração, versão, sha256) — `src/application/use-cases/snapshot.test.ts`

## 3. Adapters e composição

- [x] 3.1 Repositórios `pg-ingestion-run-repository`, `pg-ingestion-corpus-repository`, `pg-ingestion-database` e `pg-embedding-cache` — `pg-ingestion-repositories.test.ts` e `test/integration/ingest/ingest-document-version.test.ts`
- [x] 3.2 `pg-snapshot-codec` (JSON Lines + zstd do `node:zlib`) e `pg-snapshot-repository` (cursor em `REPEATABLE READ`, promoção por tabelas temporárias e chave natural) — testes unitários e `test/integration/ingest/snapshot.test.ts`
- [x] 3.3 Medidor de CU-s pela API v2 do Neon (`adapters/out/neon`) e `BlobStore` em memória (`adapters/out/fakes`) — testes unitários
- [x] 3.4 `createIngestionContainer(env, config, deps)` e o `IngestionContainer` em `application/container.ts`; handlers `runSnapshotExport`/`runSnapshotPromote` — `src/adapters/in/cli/snapshot/snapshot.test.ts`
- [x] 3.5 Variáveis `EMBED_NEURON_BUDGET`, `INGEST_MAX_DB_BYTES`, `NEON_API_KEY_STAGING` e `NEON_STAGING_PROJECT_ID` no `config/env.ts` (frente D) e a fiação na raiz de composição e no `cli.ts`: `createIngestionIo` (SafeFetcher, Netlify Blobs ou memória, hash), `createFixtureCorpusReader`, `createCoverageMarkTargets` (um pool `teko-watch` por URL, sem `loadCliEnv`) e o despacho de `sources-watch` (allowlist = hosts do `sources.yaml` ∪ `watch.yaml`) e `coverage-mark` — `pnpm --filter @teko/api typecheck`, `pnpm lint:deps`
- [x] 3.6 Nível dos dispositivos pela cadeia de `parent` (não pelo número de segmentos da `stable_key`: a REINF achata os grupos) no `pg-ingestion-corpus-repository` e no `pg-corpus-writer` — `pg-ingestion-provision-levels.test.ts`, caso "REINF: grupos achatados" em `test/integration/ingest/ingest-document-version.test.ts` e os leiautes reais da REINF em `test/integration/cli/ingest-cli.test.ts`
- [x] 3.7 Adapter Postgres do `FixtureCorpusReader` (`pg-fixture-corpus-reader.ts`: documentos e cobertura no formato da fixture; chaves de versão derivadas `v<published_on>-<sha256[0:8]>`) — round-trip seed → leitura em `test/integration/ingest/fixture-corpus-reader.test.ts`

## 4. DoD da F3 (integração, Testcontainers)

- [x] 4.1 Segunda execução da mesma versão: 0 linhas novas e 0 chamadas/neurons; novo download com o mesmo conteúdo só acrescenta fontes — `test/integration/ingest/ingest-document-version.test.ts`
- [x] 4.2 Retomada depois do `budget_exhausted`, sem reembutir o que já estava no cache — idem
- [x] 4.3 Anomalia `pending` sobreposta publica o documento e deixa 1 item na fila (sem duplicar na reingestão) — idem
- [x] 4.4 Consolidado novo (fecha redações sumidas, alarga idênticas, fecha o snapshot anterior) e Guia (alarga períodos consecutivos, recorta na corretiva) — idem
- [x] 4.5 Snapshot da fixture promovido num banco vazio com o `HybridSearch` idêntico no golden inteiro e no `questions.json`; promoção repetida idempotente; `verified_at` de produção preservado; arquivo adulterado recusado; retenção de 3 — `test/integration/ingest/snapshot.test.ts`
- [x] 4.6 Guarda de tamanho e `--bulk` (HNSW derrubado e recriado) — `test/integration/ingest/ingest-document-version.test.ts`

## 5. Documentação

- [x] 5.1 ADR 0025 (reconciliação incremental e identidade no snapshot), proposta — `docs/adr/0025-reconciliacao-incremental-e-snapshot.md`
- [x] 5.2 Índice de ADRs (`docs/adr/README.md`) e o plano ("Escrita, Blobs, snapshot e promoção": recorte fora da janela, `ingestion_runs.neurons`, colunas da `review_queue`) atualizados pelo orquestrador

## 6. CLI e fontes (frente D)

- [x] 6.1 `corpus/sources.yaml` (C1 e C2, URLs e sha256 reais, fontes indisponíveis com `enabled: false` e motivo), `leiaute-periods.yaml` (Ato COTEPE/ICMS 44/2018 e ADE Cofis), `overrides/` (schema e exemplo), `corpus.lock.json` inicial e README
- [x] 6.2 Schema zod e loader de `corpus/` com resolução do `SourceDescriptor` (leiaute, NT, publicação, WS de tabelas) e teste sobre os arquivos reais
- [x] 6.3 `SafeFetcher` (`adapters/out/http`): https, allowlist, DNS revalidado na conexão, IPs bloqueados (v4, v6, mapeados, NAT64, 6to4), ≤ 3 redirects, 1 req/s por host, UA fixo, teto de bytes
- [x] 6.4 `BlobStore` Netlify (`adapters/out/blobs`), `consistency: 'strong'`, `us-east-2`
- [x] 6.5 `domain/corpus/overrides.ts` (approve/reject/set_interval, chave `(stable_key, note_hash)`) e loader de `corpus/overrides/*.yaml`
- [x] 6.6 Leitor de zip sem dependência (`node:zlib`), com zip aninhado e defesas
- [x] 6.7 `cli ingest discover` (plan.json, extract-matrix.json com page_range, reaproveitamento do Blobs, pin conferido)
- [x] 6.8 `cli ingest load` (ordem por published_on, overrides, Blobs, ingestDocumentVersion, refreshCoverage, exportSnapshot, lock, --report, códigos 75 e 1, --migrate/--bulk só staging)
- [x] 6.9 `cli eval-fixture export --from staging` com a porta `FixtureCorpusReader`
- [x] 6.10 Variáveis da ingestão no `env.ts` e `.env.example`
- [x] 6.11 Integração `test/integration/cli/` (discover + load com Postgres real: publicação, 2ª execução sem linhas nem neurons, código 75 e retomada)
- [x] 6.12 Fiação final no `composition-root.ts` (`createIngestionIo`, `createFixtureCorpusReader`; ver 3.5)
