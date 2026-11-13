# Proposal

## Why

O `corpus-eval` contra o staging era só informativo para o PR do lock: o `lock-pr` dependia só do
`load` e abria o PR com o eval ainda rodando (ou vermelho), e a revisão tinha de lembrar de olhar o
job. O golden de 50 casos servia ao mesmo tempo para ajustar a busca (número de candidatos do
reranker, ADR 0027; `staging_validity`) e para medi-la: um MRR ajustado nos mesmos casos que o
medem é otimista, e a meta de MRR 0,70 da F4 seria decidida assim. O resumo não dizia quanto de
uma diferença entre runs é ruído, a branch do lock (`chore/corpus-lock-<run_number>`) colidia entre
o `source-watch` e o dispatch, e não havia como avaliar uma mudança de busca contra o corpus real
sem reingerir. Revisão de arquitetura aprovada pelo mantenedor em 2026-11-12 (ADR 0031).

## What Changes

- Golden em dois conjuntos: `dev` (os 50 casos, onde se ajusta) e `holdout` (53 casos novos que
  nunca orientam parâmetros, só no `corpus-eval`). Status novo `unanswerable` (pergunta dentro da
  cobertura que o corpus não responde), com a métrica `sem_resposta`.
- `check-thresholds`: intervalo de confiança de 95% (Wilson nas proporções, erro-padrão no MRR),
  limites por suíte (`retrieval`, `retrieval-corpus`, `retrieval-holdout`), limite `null` como
  informativo e metas de fase (MRR 0,70 da F4 no holdout).
- `corpus-eval`: roda dev e holdout, grava o registro (`corpus.eval.json`) com a `corpus_version`
  avaliada e o histórico no store `eval-artifacts` (porta `BlobStore`).
- `lock-pr`: só com o `corpus-eval` verde; commita o lock e o `corpus/corpus.eval.json`; corpo do
  PR com as métricas; branch `chore/corpus-lock-<run_id>`.
- Modo `eval-only` do `ingest.yml`: sem reingerir, avalia o staging; sem `ref`, abre o PR do lock
  da `corpus_version` do staging quando ela está à frente do lock de `develop` (a partir do artifact
  `corpus-lock`, agora com 90 dias); com `ref` (SHA de um PR, pelo rótulo `corpus-eval`), avalia o
  código do PR sem abrir PR nem gravar histórico.
- `.github/affected-paths.yml`: reranker e embeddings no grupo `rag`; grupo `docs` novo.

## Capabilities

### Modified Capabilities

- `ingestion-workflow`: o PR do lock passa a depender do `corpus-eval` e a levar o resultado; o
  `corpus-eval` mede os dois conjuntos e guarda o histórico; modo `eval-only`.

## Impact

- `apps/api/evals/**` (schema, métricas, datasets, configs do promptfoo, scripts) e
  `apps/api/package.json`.
- `.github/workflows/ingest.yml`, `.github/workflows/corpus-eval-label.yml`,
  `.github/affected-paths.yml`, `.github/scripts/{affected.sh,affected.test.sh,ci-config.test.sh}`.
- ADR 0031.
