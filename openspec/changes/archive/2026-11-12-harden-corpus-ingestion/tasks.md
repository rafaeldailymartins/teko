# Tasks

## 1. Orçamento e guardas

- [x] 1.1 Orçamento por dia UTC e cota diária (429/3036) como `budget_exhausted` — `neuron-budget.test.ts`, `embed-pending.test.ts`, `workers-ai-embedding-adapter.test.ts`
- [x] 1.2 Guarda prospectiva (`INGEST_BYTES_PER_CHUNK`) — `ingest-document-version.test.ts`
- [x] 1.3 Disjuntor de mudança em massa e `--accept-churn` — `churn.test.ts`, `ingest-document-version.test.ts`, `load.test.ts`
- [x] 1.4 Gate de saúde (`health` no lock, `--max-pending-share`), fila de revisão no relatório, uma linha por item e run `failed` sem `RefreshCoverage` — `corpus-health.test.ts`, `load.test.ts`, integração

## 2. Cobertura

- [x] 2.1 `gap_entries`, limpeza pela fonte e promoção pela detecção — `coverage-gaps.test.ts`, integração `coverage-watch`, `ingest-document-version`, `snapshot`

## 3. Armazenamento

- [x] 3.1 Migração `partial-vector-indexes` (contract), vetor apagado ao fechar, snapshot sem vetor de chunk fechado — integração `ingest-document-version`, `storage`
- [x] 3.2 Poda do `embedding_cache` em run verde com todas as famílias — `prune-embedding-cache.test.ts`, integração
- [x] 3.3 `--bulk` com o HNSW parcial e 256 MB; run sem `--bulk` garante o índice na abertura (B6) — integração
- [x] 3.4 B4: redações novas começam no fechamento mais tardio — unit e integração

## 4. Reingestão, linhagem e rollback

- [x] 4.1 Impressão digital do resultado parseado (A5) e raw gravado só com versão nova — unit e integração
- [x] 4.2 `EXTRACTOR_REVISION` na chave do Docling e no `manifest.json` — `blob-keys.test.ts`, `test_manifest.py`
- [x] 4.3 Linhagem no manifesto e no lock — `snapshot.test.ts`, `load.test.ts`
- [x] 4.4 `snapshot promote --rollback`, retenção do snapshot do lock e runbook `docs/runbooks/rollback-corpus.md` — unit e integração
- [x] 4.5 A8: tabelas do `docling-generic` com uma linha por parágrafo e cabeçalho; `PARSER_REVISIONS` 2 — `docling-generic.test.ts`
