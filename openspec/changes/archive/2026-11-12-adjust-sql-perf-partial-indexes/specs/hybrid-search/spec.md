# Spec Delta

## MODIFIED Requirements

### Requirement: Gate de desempenho da busca

Todo PR que afeta a API ou a busca MUST rodar o `sql-perf` sobre 100k chunks sintéticos, que SHALL
exigir o HNSW e o GIN no plano com filtro amplo e o GiST no plano com filtro seletivo, nenhum Seq
Scan em `corpus.chunks`, k linhas do ANN com filtro seletivo e mediana abaixo de 150 ms num runner
até a velocidade de referência.

#### Scenario: Índice perdido

- **WHEN** uma mudança na instrução faz o plano varrer `corpus.chunks` sequencialmente
- **THEN** o job `sql-perf` falha e o `ci-gate` fica vermelho
