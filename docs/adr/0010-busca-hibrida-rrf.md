---

status: accepted
date: 2026-11-11
decision-makers: Rafael Daily Santos Martins
---

# 0010 — Busca híbrida numa instrução SQL, com RRF k = 60, filtrada por vigência

## Contexto e problema

As perguntas misturam termos exatos da norma ("COD_SIT", "R-4020", "art. 76, § 6º") com
descrições em linguagem comum ("códigos de situação do documento"). Só busca léxica perde as
descrições; só vetorial perde os termos exatos e as referências. Tudo precisa respeitar a vigência
na data e caber no orçamento de latência (menos de 150 ms em 100k chunks) e no custo zero (sem
reranker pago, sem serviço de busca à parte).

## Fatores de decisão

- Filtro de vigência, família e status no banco, nunca depois da busca.
- Um único round-trip ao Neon por pergunta (pooler, transação curta).
- Gates do plano: recall@10 ≥ 0,90, MRR ≥ 0,70, vigência e recusa = 1,00; `EXPLAIN` com HNSW, GIN
  e GiST e sem Seq Scan em `chunks`.

## Opções consideradas

- Busca vetorial só, com filtro depois (pós-filtragem).
- Serviço de busca externo (Elasticsearch, Typesense).
- **Uma instrução SQL com três braços (léxico, vetorial, referência citada) fundidos por RRF.**

## Decisão

Uma instrução, como no plano, com quatro ajustes medidos na F2 (fixture real de 1.574 chunks e
corpus sintético de 100k):

1. **`base` inline (`NOT MATERIALIZED`)**: materializado, o braço léxico filtrava o CTE e nunca
   usava o GIN.
2. **Braço léxico em dois estágios**: 200 candidatos por `ts_rank` e os 50 melhores por
   `ts_rank_cd`. Ordenar todos os casamentos por `ts_rank_cd` custava ~140 ms sobre 16 mil linhas.
3. **Braço da referência ordenado por relevância**: a chave citada sempre entra; os descendentes
   dela entram se já estão nos outros braços; a ordem é a melhor posição léxica ou semântica. Com
   a ordem por `sort_path` do plano, a menção a um registro ("C100") dava ao registro-pai o voto
   inteiro do braço, à frente do campo perguntado (MRR 0,58).
4. **Texto de embedding com o caminho de títulos** (`heading_path` + conteúdo): o campo curto do
   Guia passa a ser reconhecido como "campo do C100" no braço semântico.

As retrieval evals contam recall e MRR por dispositivo distinto (uma redação longa vira vários
chunks seguidos e não ocupa várias posições).

### Consequências

- Bom, porque os gates passam: recall@10 0,925, MRR 0,771, vigência, recusa, clarificação e data
  de referência 1,00; `sql-perf` com mediana de 117 ms (todas as famílias) e 134 ms (uma família)
  em 100k chunks, no Docker Desktop do Windows.
- Bom, porque o Postgres escolhe o plano pelo custo: KNN exato sobre o GiST com filtro seletivo,
  HNSW com iterative scan (`relaxed_order`) com filtro amplo; o `sql-perf` confere os dois e que o
  HNSW forçado devolve k linhas sob filtro seletivo.
- Ruim, porque a folga para 150 ms é pequena numa máquina lenta; se o runner do CI ficar acima,
  o próximo passo é o SQL (ex.: menos candidatos léxicos), não o gate.
- Neutro: o reranker continua fora do MVP; três casos do golden ficam fora do top-10 (pergunta em
  inglês, dispositivo revogado sem texto, um campo do R-4020) e medem essa limitação.

## Mais informações

- `apps/api/src/adapters/out/persistence/drizzle/sql/hybrid-search.ts` e
  `apps/api/test/sql-perf/hybrid-search.perf.test.ts`.
- Mudança OpenSpec `add-hybrid-search` (F2); plano: "Busca híbrida" e "Avaliação".
