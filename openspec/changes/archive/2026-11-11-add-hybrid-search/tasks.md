# Tasks

## 1. Busca

- [x] 1.1 Instrução SQL híbrida (`hybrid-search.ts`) e variante `lexical_only`, com `SET LOCAL` do HNSW na transação curta — `test/integration/corpus/hybrid-search.test.ts`
- [x] 1.2 `PgSearchRepository`, `HybridSearch` (degradação `lexical_only`), `RetrieveEvidence` (recusas `out_of_coverage` e `no_evidence`) e `extractProvisionRefs` — testes unitários e de integração
- [x] 1.3 Cenários do DoD contra o Postgres real: 05/2006 com só o snapshot 2026 devolve o Dec. 6.026; data depois do `verified_at` recusada; § 6º em 2004, 2006 e 2010 — `pnpm --filter @teko/api test:integration`

## 2. Retrieval evals

- [x] 2.1 Dataset golden de 50 casos na distribuição do plano, validado pelo schema (`evals/datasets/golden.yaml`, curadoria assistida, `reviewed_at: null`)
- [x] 2.2 Provider in-process, asserts por métrica, `thresholds.json` e `check-thresholds.ts` — `pnpm --filter @teko/api eval:retrieval && pnpm --filter @teko/api eval:retrieval:check` (recall@10 0,925; MRR 0,771; demais 1,00)
- [x] 2.3 Job `retrieval-evals` no `ci.yml` (Postgres de serviço, fake strict, sem segredo) — actionlint e `ci-config.test.sh`

## 3. Desempenho e mutação

- [x] 3.1 `perf/seed/synthetic.sql` (100k chunks) e `test/sql-perf` (EXPLAIN nos dois perfis, ANN com k linhas, mediana < 150 ms) — `pnpm --filter @teko/api test:sql-perf`
- [x] 3.2 `perf.yml` (perfil `pr`) e `mutation.yml` (incremental no PR, completo à noite) no `pr-gate.yml` e no `ci-gate` — actionlint e `ci-config.test.sh`

## 4. Documentação

- [x] 4.1 ADR 0010 (busca híbrida RRF) e plano atualizado (Busca híbrida e Avaliação)
