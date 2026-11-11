# Proposal

## Why

Com a data resolvida e a cobertura conferida, a API precisa achar as redações em vigor naquela
data, citá-las pelo documento certo e provar, a cada PR, que a qualidade e o desempenho da busca
não regrediram. É a terceira mudança da F2.

## What Changes

- Busca híbrida numa só instrução SQL (`adapters/out/persistence/drizzle/sql/hybrid-search.ts`):
  braço léxico (OR dos lexemas, `ts_rank` para os 200 candidatos e `ts_rank_cd` para os 50),
  braço vetorial (HNSW com iterative scan `relaxed_order`) e braço da referência citada, fundidos
  por RRF k = 60; filtro de vigência, conhecimento, família e status no mesmo `WHERE`; citação pela
  versão de documento publicada que contém a data, ou pelo snapshot mais recente.
- Casos de uso `HybridSearch` (degradação para `lexical_only` sem embedding) e `RetrieveEvidence`
  (data → cobertura → busca, com recusa `no_evidence`), e a extração de referências citadas na
  pergunta (`domain/qa/provision-refs.ts`).
- Retrieval evals no PR (`apps/api/evals`, promptfoo 0.125.1 no lockfile): dataset golden de 50
  casos, provider in-process, asserts por métrica, `thresholds.json` e `check-thresholds.ts`; job
  `retrieval-evals` no `ci.yml` (Postgres de serviço, sem segredo).
- `sql-perf` sobre 100k chunks sintéticos (`perf/seed/synthetic.sql`) no `perf.yml` (perfil `pr`)
  e o `mutation.yml` (Stryker incremental), ambos no `pr-gate.yml`.
- Fora de escopo: as rotas que expõem a busca (`POST /api/v1/questions`, `GET /api/v1/_eval/search`,
  F4), generation evals e red team (F8), Vitest bench, autocannon e k6 (F4 e F8) e reranker (fora
  do MVP; as evals medem a necessidade).

## Capabilities

### New Capabilities

- `hybrid-search`: busca filtrada por vigência, citação do documento e gates de qualidade e
  desempenho da busca.

### Modified Capabilities

- `quality-gates`: o `ci-gate` agrega mutação, `sql-perf` e retrieval evals.

## Impact

- ADR 0010 (busca híbrida RRF: SQL, ajustes medidos pelas evals e pelo sql-perf).
- Plano: seção "Busca híbrida" (braço léxico em dois estágios, `base` inline, braço da referência
  ordenado por relevância) e "Avaliação" (métricas por dispositivo distinto).
- Nova devDependency: `promptfoo` 0.125.1 (proveniência SLSA; overrides de `glob` e `basic-ftp`
  na árvore dele).
