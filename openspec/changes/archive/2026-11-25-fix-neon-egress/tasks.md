# Tasks

## 1. Investigação

- [x] 1.1 Medir o vetor em texto e em binário (vetores BGE-M3 da fixture e Postgres 18 com
  pgvector 0.8.6) e levantar os runs do ciclo; tabela de estimativas por fluxo no `design.md`

## 2. Ingestão sem vetor saindo do banco

- [x] 2.1 `EmbeddingCache.cachedHashes` no lugar de `getMany`; `retainOnly` como `DELETE` no banco
  (verificar: `vitest run --project unit src/adapters/out/persistence/drizzle/repositories`)
- [x] 2.2 `NewChunkRow.embeddingHash` e cópia do vetor por subconsulta no `insertVersions`, com a
  conferência de chunk sem vetor; `EmbedPending` e `IngestDocumentVersion` só conferem chaves
  (verificar: `vitest run --project unit src/application/use-cases`)
- [x] 2.3 Poda só em run que publicou (`load.ts`) (verificar: `load.test.ts`)
- [x] 2.4 Integração: todo chunk aberto com o vetor do cache depois da ingestão (verificar:
  `vitest run --project integration test/integration/ingest/ingest-document-version.test.ts`)

## 3. Snapshot

- [x] 3.1 `halfvec-wire.ts` (binário do `halfvec_send` → texto do `halfvec_in`) e a exportação dos
  chunks pelo binário (verificar: `halfvec-wire.test.ts`, `pg-snapshot-repository.test.ts`)
- [x] 3.2 `reuseExisting` no `ExportSnapshot` e no `load`; `parseManifest` compartilhado com o
  `PromoteSnapshot` (verificar: `snapshot.test.ts`, `load.test.ts`)
- [x] 3.3 Integração: texto convertido igual ao `halfvec` do banco em 300 vetores reais e todos os
  vetores iguais depois da promoção (verificar: `test/integration/ingest/snapshot.test.ts`)

## 4. Monitoramento e guarda

- [x] 4.1 `teko_neon_data_transfer_ratio` no `scripts/ops-metrics.ts` e em `KNOWN_METRICS`
  (verificar: `node --test scripts/ops-metrics.test.ts`)
- [x] 4.2 Alertas `teko-neon-transfer-50` e `-80`, `REQUIRED_ALERTS`, painel no dashboard de cotas,
  `infra/grafana/README.md` e `observabilidade.md` (verificar: `node --test
  scripts/grafana-apply.test.ts`)
- [x] 4.3 `scripts/neon-transfer-guard.ts` e o job `neon-transfer` do `ingest.yml`, com
  `allow_high_transfer` e o número no resumo; checagens no `ci-config.test.sh` (verificar: `node
  --test scripts/neon-transfer-guard.test.ts`, actionlint e `bash .github/scripts/ci-config.test.sh`)

## 5. Docs

- [x] 5.1 Runbook `neon-suspended.md` (transferência acima da cota: culpado, esperar o ciclo ou
  trocar de projeto), `contas-e-cotas.md` e `docs/status.md` (incidente de 2026-11-18)
