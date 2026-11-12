# Tasks

## 1. Busca

- [x] 1.1 Deduplicação por versão de dispositivo nos três braços e RRF por versão em `hybrid-search.ts` (variantes híbrida e `lexical_only`)
- [x] 1.2 Teste de integração com um dispositivo de vários chunks: um resultado só, e o voto dos braços somado
- [x] 1.3 Retrieval evals na fixture sem regressão (recall@10 0,925; MRR 0,771; demais 1,00) e `sql-perf` dentro do gate

## 2. Corpus real

- [x] 2.1 `corpus-eval` contra o staging depois do merge, com o resultado registrado aqui — run 43256682008: recall@10 0,775 e MRR 0,530, iguais a antes; a métrica já contava dispositivos distintos, então a deduplicação não a muda, mas libera vagas repetidas no top-12 da API
