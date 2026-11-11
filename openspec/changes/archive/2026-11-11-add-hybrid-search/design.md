# Design

## Context

O plano traz a instrução SQL da busca, os gates das retrieval evals (recall@10 ≥ 0,90, MRR ≥ 0,70,
vigência = 1,00, recusa = 1,00) e do `sql-perf` (HNSW, GIN e GiST no `EXPLAIN`, sem Seq Scan em
`chunks`, ANN filtrado com k linhas, menos de 150 ms em 100k chunks). A F2 mede os dois contra a
fixture real e o corpus sintético, e ajusta a instrução onde a medição mostrou que o texto do
plano não atingia o próprio gate.

## Goals / Non-Goals

**Goals:**

- Todo resultado em vigor na data de referência, por construção (filtro no SQL).
- Gates do plano atingidos, medidos localmente e no CI.
- Evals sem segredo e sem LLM, rodando em PR de fork.

**Non-Goals:**

- Reranker e ajuste fino de pesos do RRF.
- Rotas HTTP da busca (F4).

## Decisions

- **`base` inline (`NOT MATERIALIZED`).** Materializado (padrão do PG para CTE usado duas vezes),
  o braço léxico filtrava o CTE e nunca usava o GIN do `tsv`. Inline, o planner combina GIN e GiST
  (BitmapAnd).
- **Braço léxico em dois estágios.** Ordenar todas as linhas que casam por `ts_rank_cd` custava
  ~140 ms sobre 16 mil casamentos no `sql-perf`; o primeiro estágio pega os 200 melhores por
  `ts_rank` (~40 ms) e o segundo ordena esses 200 por `ts_rank_cd`, como o plano pede.
- **Braço da referência ordenado por relevância.** Do jeito do plano (`stable_key = ANY($5)`
  ordenado por `sort_path`), uma menção a registro ou evento ("C100", "R-4020") dava ao dispositivo
  pai o voto inteiro do braço, e ele passava na frente do campo perguntado mesmo quando o campo era
  o 1º nos braços léxico e semântico (MRR 0,58 na fixture). Agora a chave citada sempre entra (a
  garantia do braço) e os descendentes dela entram se já estão nos outros braços; a ordem é a
  melhor posição léxica ou semântica. O conjunto parte só dos candidatos dos outros braços e dos
  chunks da chave citada, para não varrer o `base` (um primeiro desenho com `OR` sobre o `base`
  trouxe Seq Scan em `chunks` e foi descartado).
- **Métricas por dispositivo distinto.** O golden espera dispositivos; uma redação longa vira
  vários chunks seguidos e ocupava várias posições do top-k. recall@10 e MRR contam a lista de
  `stable_key` distintas na ordem.
- **Texto de embedding com o caminho de títulos** (mudança `add-validity-domain`): MRR de 0,577
  para 0,630 antes do ajuste do braço da referência.
- **Plano de execução escolhido pelo custo.** Com filtro seletivo (uma família numa data, ~4% das
  linhas), o Postgres prefere o KNN exato sobre o GiST ao HNSW, que é mais barato e exato; com
  filtro amplo, usa o HNSW. O `sql-perf` confere os dois perfis e, com o HNSW forçado, que o
  iterative scan devolve k linhas sob filtro seletivo.
- **promptfoo no lockfile, não por `npx`.** Regra do repositório; o provider chama o
  `RetrieveEvidence` in-process com `createContainer`. `PROMPTFOO_FAILED_TEST_EXIT_CODE=0` deixa o
  gate com o `check-thresholds.ts` (média por métrica), e erro do provider continua derrubando.
- **Mutação incremental no PR.** O relatório incremental do nightly (cache salvo só fora de PR)
  faz o Stryker testar só os mutantes do código mudado.

## Resultados medidos (2026-11-11)

| Gate                                                 | Valor                                       | Onde                                   |
| ---------------------------------------------------- | ------------------------------------------- | -------------------------------------- |
| recall@10                                            | 0,925 (40 casos)                            | retrieval evals, fixture única         |
| MRR                                                  | 0,771                                       | idem                                   |
| vigência, recusa, clarificação, data de referência   | 1,00                                        | idem                                   |
| `sql-perf` mediana (todas as famílias / uma família) | 117 ms / 134 ms                             | 100k chunks, Docker Desktop no Windows |
| `EXPLAIN` filtro amplo                               | HNSW + GIN + GiST, sem Seq Scan em `chunks` | idem                                   |

## Risks / Trade-offs

- O orçamento de 150 ms tem pouca folga numa máquina lenta. Mitigação: o `sql-perf` mede a mediana
  de 15 execuções aquecidas; se o runner do CI ficar acima, o ajuste é do SQL, não do gate.
- Três casos do golden ficam fora do top-10 (pergunta em inglês sobre o art. 71, o § 6º revogado
  em 2010 e um campo do R-4020 em 2024); o recall continua acima do gate e os casos ficam como
  medida honesta das limitações.

## Fontes Context7

| Biblioteca    | ID Context7                                | Versão conferida | Tópicos                                                                                                                                                |
| ------------- | ------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| pgvector      | `/pgvector/pgvector`                       | 0.8.6            | `hnsw.iterative_scan` (`relaxed_order`), `hnsw.ef_search`, `hnsw.max_scan_tuples`, comportamento do scan com filtro                                    |
| promptfoo     | `/promptfoo/promptfoo`                     | 0.125.1          | provider TypeScript (`callApi`), asserts `javascript` de arquivo, `tests: file://` gerado, métricas nomeadas, JSON de saída, `--no-cache`/`--no-write` |
| StrykerJS     | `/stryker-mutator/stryker-js/v10.1.1`      | 10.1.1           | `incremental`, `incrementalFile`, `--force`                                                                                                            |
| Drizzle ORM   | `/websites/rqbv2_drizzle-orm-fe_pages_dev` | 1.0.0-rc.5       | `sql` e transações (a busca roda em `pg` direto, com `SET LOCAL`)                                                                                      |
| node-postgres | `/brianc/node-postgres`                    | 8.23.1           | `pool.connect()`/`release()` para a transação curta                                                                                                    |
