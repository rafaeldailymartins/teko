# Tasks

## 1. Golden em dois conjuntos

- [x] 1.1 Schema: status `unanswerable`; métrica e assert `sem_resposta`
- [x] 1.2 `holdout.yaml` com 53 casos conferidos (parsers locais, fixture, PDFs e `resolveReferenceDate`)
- [x] 1.3 Geradores `devTests` e `holdoutTests`; `holdout.promptfooconfig.yaml`; scripts do `package.json`
- [x] 1.4 Eval da fixture igual ao de `develop`, caso a caso

## 2. Gates e registro

- [x] 2.1 `check-thresholds`: intervalo de confiança, suíte `retrieval-holdout`, limite `null` e `metas`
- [x] 2.2 `corpus-eval-record.ts` (`build` e `history`) com testes

## 3. Workflows

- [x] 3.1 `corpus-eval` com dev, holdout, registro e histórico
- [x] 3.2 `lock-pr` depois do `corpus-eval` verde, com o `corpus.eval.json` e branch por `run_id`
- [x] 3.3 Modo `eval-only` (com e sem `ref`) e `corpus-eval-label.yml`
- [x] 3.4 `affected-paths.yml` (reranker e embeddings no `rag`, grupo `docs`) e testes; `ci-config.test.sh`

## 4. Documentação

- [x] 4.1 ADR 0031
