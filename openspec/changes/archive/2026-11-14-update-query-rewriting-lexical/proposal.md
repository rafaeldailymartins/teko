# Proposal

## Why

O `corpus-eval` com a reescrita da pergunta em todos os braços (run 43640409545) piorou o MRR: 0,649
no dev e 0,622 no holdout, contra 0,714 e 0,654 sem reescrita. A consulta do LLM é uma lista de
termos: ajuda o braço léxico, mas o embedding e o reranker comparam frases. Com a consulta só no
léxico (run 43641962158), o MRR foi a 0,718 no dev e 0,668 no holdout, sem regressão.

## What Changes

- O embedding e o reranker voltam a receber a pergunta original; só o braço léxico recebe a
  pergunta e a consulta. O despejo do pool do eval faz o mesmo.

## Capabilities

### Modified Capabilities

- `hybrid-search`: a consulta reescrita vai só para o braço léxico.

## Impact

- `apps/api`: `HybridSearch` e o provider das evals; ADR 0034 e o registro das medições.
