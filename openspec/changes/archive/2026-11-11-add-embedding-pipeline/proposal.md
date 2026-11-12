# Proposal

## Why

A F2 grava o corpus de uma vez, a partir da fixture. A ingestão real da F3 recebe uma versão de
documento por vez (consolidado novo do RCTE, Guia Prático por período, versão corretiva, tabela de
códigos) e precisa publicá-la sem duplicar o que já existe, sem reembutir texto que não mudou
(8.000 neurons/dia de orçamento) e sem perder o histórico bitemporal. Depois, o staging exporta um
snapshot que a produção promove no release, com 0 neurons e sem ler o banco de staging. É a
mudança `add-embedding-pipeline` da F3 (roteiro, "F3: Ingestão das ondas C1 e C2, embeddings e
watch").

## What Changes

- Casos de uso de ingestão em `apps/api/src/application/use-cases`: `ingestion-run`
  (abertura/fechamento do run, `--bulk`, CU-s do Neon, tamanho do banco), `ingest-document-version`
  (reconciliação incremental por versão de documento, transação por versão, fila de revisão),
  `embed-pending` (lotes, concorrência 2, backoff, checkpoint no `embedding_cache`),
  `refresh-coverage`, `export-snapshot` e `promote-snapshot`; serviço `neuron-budget` (orçamento
  diário por dia de `America/Sao_Paulo`, custo real do `onUsage`).
- Portas novas (`corpus-ingestion-repository`, `ingestion-run-repository`, `embedding-cache`,
  `snapshot-repository`, `database-usage`) e adapters: repositórios Drizzle/`pg`
  (`pg-ingestion-*`, `pg-embedding-cache`, `pg-snapshot-*`), medidor de CU-s pela API v2 do Neon
  (`adapters/out/neon`) e o `BlobStore` em memória para testes.
- Migração `ingestion-pipeline`: `ingestion_runs.neurons` (custo real) e, na `review_queue`,
  `stable_key`, `note_hash`, `provision_version_id`, `document_version_id` e o índice único parcial
  `(stable_key, note_hash) WHERE status = 'open'`. Só colunas e índice novos (expand).
- `createIngestionContainer(env, config, deps)` em `composition-root.ts`, com o `BlobStore` e os
  demais adapters externos recebidos por parâmetro; handlers `runSnapshotExport` e
  `runSnapshotPromote` em `adapters/in/cli/snapshot`.
- Testes de integração em `apps/api/test/integration/ingest/` que provam o DoD da F3 (segunda
  execução sem linhas nem neurons, retomada depois do orçamento, anomalia sobreposta, consolidado
  novo, snapshot promovido num banco vazio com o `HybridSearch` idêntico, guarda de tamanho).
- ADR 0025 (reconciliação incremental e identidade no snapshot), proposta.
- CLI e fontes (frente D, spec `corpus-ingestion` nesta mesma mudança): `corpus/sources.yaml`,
  `SafeFetcher`, Netlify Blobs, `cli ingest discover|load`, `eval-fixture`, `corpus.lock.json`.

Fora de escopo: o workflow `ingest.yml` e o `source-watch` (frente E, `add-source-change-monitoring`),
os parsers (`add-rcte-cte-html-parser`, `add-sped-guides-ingestion`, `add-go-code-tables-ingestion`),
a aplicação de overrides na ingestão (frente D), o job `promote-corpus` do release (F7/F9) e
qualquer gravação real no Neon, no Blobs ou no Workers AI (só depois do merge, pelo workflow).

## Capabilities

### New Capabilities

- `embedding-pipeline`: publicação incremental do corpus com embeddings sob orçamento, cobertura,
  snapshot e promoção.
- `corpus-ingestion`: fontes, download seguro, Blobs e CLI de ingestão (frente D).

### Modified Capabilities

- Nenhuma (o `corpus-schema` ganha só colunas novas, descritas aqui).

## Impact

- ADR 0009 (vigência bitemporal: o recorte da redação fora da janela) e ADR 0025 (nova, proposta).
- Plano, "Escrita, Blobs, snapshot e promoção": a regra "fecha o `knowledge` da redação que cruza a
  janela" ganha o recorte dos trechos fora da janela (ADR 0025); registrar no plano no PR da F3.
- Nenhuma dependência nova: zstd do `node:zlib` (Node 24), `pg` e Drizzle já no catálogo.
- Variáveis novas no `config/env.ts` (frente D): `EMBED_NEURON_BUDGET`, `INGEST_MAX_DB_BYTES`,
  `NEON_API_KEY_STAGING`, `NEON_STAGING_PROJECT_ID`.
