# Proposal

## Why

A meta da F4 é MRR ≥ 0,70 no `holdout` do `corpus-eval`. O contexto do dispositivo-pai no reranker
(PR #89) levou o MRR de 0,475 para 0,654; as falhas que restam são de vocabulário: a pergunta vem
na linguagem de contador ou em inglês ("alíquota geral nas vendas dentro de Goiás", "income tax
withheld"), e o corpus está na linguagem da lei e dos leiautes ("operações internas", "Valor da
retencao do IR"). O roteiro prevê a reescrita da pergunta pelo LLM antes da busca.

## What Changes

- Reescrita da pergunta (já redigida) pela cadeia de LLM, antes da busca: prompt versionado
  (`rewrite@1.0.0`), temperatura 0, até 120 tokens, teto de 4 s, mesma política regional e os
  mesmos breakers da resposta. Falha, teto ou saída vazia seguem com a pergunta original.
- Na busca, o braço léxico recebe a pergunta e a consulta; o embedding e o reranker, a consulta; as
  referências citadas saem das duas. O resultado traz a consulta usada.
- `QUERY_REWRITE_ENABLED` (padrão desligado, exige `LLM_PROVIDER`). O `corpus-eval` liga a
  reescrita quando o environment `staging` tem as chaves do LLM, e grava a consulta no relatório.

## Capabilities

### Modified Capabilities

- `hybrid-search`: requisitos novos de reescrita da pergunta e da degradação dela.

## Impact

- `apps/api`: prompt e serviço de reescrita, `HybridSearch`, `RetrieveEvidence`, pipeline da
  resposta, composição (um `ProviderRouter` só para reescrita e resposta), env, fake de LLM, evals.
- `.github/workflows/ingest.yml` e `source-watch.yml`: chaves do LLM no `corpus-eval`.
- ADR 0034; `backend.md` e `status.md`.
