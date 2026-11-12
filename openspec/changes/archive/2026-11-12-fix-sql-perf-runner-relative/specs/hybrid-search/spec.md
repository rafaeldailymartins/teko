# Spec Delta

## MODIFIED Requirements

### Requirement: Gate de desempenho da busca

Todo PR que afeta a API ou a busca MUST rodar o `sql-perf` sobre 100k chunks sintéticos, que SHALL
exigir HNSW, GIN e GiST no plano com filtro amplo, nenhum Seq Scan em `corpus.chunks`, k linhas do
ANN com filtro seletivo e mediana abaixo de 150 ms num runner até a velocidade de referência. A
velocidade do runner SHALL ser medida no mesmo run por uma consulta que não depende da busca, e o
teto MUST ser `150 ms × max(1, referência ÷ referência de corte)`, com a referência de corte no
topo da faixa observada no CI.

#### Scenario: Índice perdido

- **WHEN** uma mudança na instrução faz o plano varrer `corpus.chunks` sequencialmente
- **THEN** o job `sql-perf` falha e o `ci-gate` fica vermelho

#### Scenario: Runner mais lento que o de referência

- **WHEN** a referência mede 330 ms (corte de 280 ms) e a busca com uma família leva 160 ms
- **THEN** o teto é 150 × 330 ÷ 280 ≈ 177 ms e o job passa, porque a lentidão é do runner e não da busca
