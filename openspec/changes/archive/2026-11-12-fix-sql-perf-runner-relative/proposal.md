# Proposal

## Why

O `sql-perf` reprovava PRs que não mexiam na busca: sem mudança no SQL, a mediana com uma família
variou de 96 ms (#37) a 160 ms (#49) entre runs, contra o teto fixo de 150 ms. A variação vem do
runner do GitHub; no runner lento as duas medidas sobem juntas.

## What Changes

- O `sql-perf` mede a velocidade do runner no próprio run, com uma referência que não depende da
  busca (KNN exato por força bruta sobre os 100k vetores, sem índice), e o teto da mediana vira
  `150 ms × max(1, referência ÷ 280 ms)`.
- 280 ms é a maior mediana da referência observada em 7 runs do CI: em todo runner medido o teto
  continua 150 ms. Como a busca cresce menos que a referência (+40% contra +64% na faixa medida),
  um runner mais lento que todos os observados ganha folga menor que a própria lentidão.

## Capabilities

### Modified Capabilities

- `hybrid-search`: o gate de desempenho é relativo à velocidade do runner.

## Impact

- `apps/api/test/sql-perf/hybrid-search.perf.test.ts`. Sem mudança na busca nem no workflow.
