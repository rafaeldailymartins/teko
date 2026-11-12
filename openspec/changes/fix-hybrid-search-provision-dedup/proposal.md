# Proposal

## Why

O primeiro `corpus-eval` contra o corpus real do staging (2026-11-12, run 43250731634) reprovou o
gate: recall@10 de 0,775 e MRR de 0,532 (gates 0,90 e 0,70; a fixture dá 0,925 e 0,771). Os
dispositivos esperados existem no banco; o problema é o ranking. A busca ranqueia chunks, e um
dispositivo partido em vários chunks (a página de um registro da EFD, com a tabela de campos)
ocupa várias vagas do top-k: na pergunta sobre o `COD_SIT` do C100, as três primeiras posições
eram `reg:C100`. Quando os braços léxico e vetorial escolhem chunks diferentes do mesmo
dispositivo, o voto do RRF também se divide entre eles.

## What Changes

- `hybrid-search.ts`: cada braço (léxico, vetorial e da referência citada) ranqueia só o melhor
  chunk de cada versão de dispositivo (`provision_version_id`), e o RRF soma os votos por versão,
  com o chunk mais bem colocado como representante. O braço vetorial continua com o ANN no CTE
  materializado (HNSW com iterative scan); a deduplicação roda sobre as linhas que ele devolveu.
- O braço da referência citada procura a posição nos outros braços pela versão de dispositivo,
  não pelo chunk.
- Fora de escopo: reranker, mudança de `ARM_LIMIT`, dos pesos do `tsvector` ou do chunking. O
  `corpus-eval` depois do merge mede o quanto a deduplicação resolve.

## Capabilities

### Modified Capabilities

- `hybrid-search`: a busca devolve no máximo um resultado por versão de dispositivo.

## Impact

- `apps/api/src/adapters/out/persistence/drizzle/sql/hybrid-search.ts` e testes.
- Sem migração, sem dependência nova. O `sql-perf` continua exigindo HNSW, GIN e GiST no plano e
  mediana abaixo de 150 ms.
