# Proposal

## Why

Com o HNSW e o GIN de `corpus.chunks` parciais (`WHERE upper_inf(knowledge)`, mudança
`harden-corpus-ingestion`), o plano com filtro amplo deixa de usar o GiST de `(family,
valid_during)`: o braço da referência citada parte do índice único de `stable_key`, como o SQL
prevê. A mediana, medida na mesma máquina antes e depois, ficou na mesma proporção da referência
(0,68 contra 0,69 com filtro amplo; 0,63 contra 0,61 com uma família). O `sql-perf` exigia o GiST
nesse plano e reprovava sem regressão.

## What Changes

- O `sql-perf` com filtro amplo exige o HNSW e o GIN, sem Seq Scan; o GiST continua exigido no
  plano com filtro seletivo.

## Capabilities

### Modified Capabilities

- `hybrid-search`: o gate de desempenho com os índices parciais.
