# Proposal

## Why

O plano deixou o reranker fora do MVP, "medida a necessidade pelas retrieval evals". O
`corpus-eval` contra o staging mediu (2026-11-12, run 43264686108): depois das correções de parser,
recall@10 de 0,875 e MRR de 0,596, para gates de 0,90 e 0,70. Dos 40 casos com resposta, 17 têm o
dispositivo certo entre a 2ª e a 12ª posição. Num experimento offline com os candidatos reais, o
`@cf/baai/bge-reranker-base` do Workers AI levou o MRR desses 12 candidatos de 0,596 a 0,687 (11
casos subiram para a 1ª posição), com cerca de 1 neuron por pergunta, dentro da cota gratuita.

## What Changes

- Porta `RerankerPort` e adapter REST do Workers AI (`@cf/baai/bge-reranker-base`), com o mesmo
  host fixo e o mesmo tratamento de falha do adapter de embeddings.
- `RERANKER_PROVIDER` (`none`, padrão, ou `workers-ai`), com as credenciais `CF_ACCOUNT_ID` e
  `CF_AI_TOKEN` já usadas pelos embeddings.
- `HybridSearch`: com reranker, pede 30 candidatos à instrução híbrida, reordena pela nota do
  reranker (rótulo de citação e conteúdo do chunk) e devolve os 12 primeiros. Falha ou mais de 2 s
  de reranker mantêm a ordem do RRF, sem falhar a pergunta; o resultado diz se foi reordenado.
- `corpus-eval` (`ingest.yml`) com `RERANKER_PROVIDER=workers-ai`. As retrieval evals do PR seguem
  sem reranker (fake de embeddings, sem segredo).
- Fora de escopo: fusão ponderada entre RRF e reranker (no experimento, não superou o reranker
  puro: 0,690 contra 0,687, com risco de sobreajuste a 40 casos) e as env vars da API em staging e
  produção, que a F7 automatiza.

## Capabilities

### Modified Capabilities

- `hybrid-search`: a busca pode reordenar os candidatos por um reranker, com degradação para a
  ordem do RRF.

## Impact

- `apps/api`: porta, adapter, `config/env.ts`, `composition-root.ts`, `HybridSearch` e testes.
- `.github/workflows/ingest.yml` (job `corpus-eval`).
- Plano (tabela de desvios e "Busca híbrida"), ADR 0001 (tabela) e ADR 0027.
