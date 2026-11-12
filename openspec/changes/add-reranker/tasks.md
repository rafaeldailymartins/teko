# Tasks

## 1. Reranker

- [x] 1.1 `RerankerPort`, adapter REST do Workers AI (`@cf/baai/bge-reranker-base`) e testes do adapter
- [x] 1.2 `RERANKER_PROVIDER` em `config/env.ts` e montagem no `composition-root.ts`
- [x] 1.3 `HybridSearch`: 40 candidatos, reordenação, 12 devolvidos, degradação (erro e teto de 3 s) e `reranked`

## 2. Verificação

- [x] 2.1 Testes unitários da `HybridSearch` (reordena, degrada por erro, degrada por tempo, cancelamento propaga, sem reranker) e gates locais
- [x] 2.2 `corpus-eval` com `RERANKER_PROVIDER=workers-ai`: com 30 candidatos, recall@10 0,900 e MRR 0,639–0,673 (runs 43275291067 e 43280624846); a simulação sobre o despejo (run 43282477443) levou a 40 candidatos e teto de 3 s

## 3. Documentação

- [x] 3.1 ADR 0027, plano (tabela de desvios e "Busca híbrida") e tabela do ADR 0001
