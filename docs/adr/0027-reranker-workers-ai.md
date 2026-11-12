---

status: accepted
date: 2026-11-12
decision-makers: Rafael Daily Santos Martins
---

# 0027 — Reranker do Workers AI na busca híbrida

## Contexto e problema

O plano deixou o reranker fora do MVP, "medida a necessidade pelas retrieval evals" (ADR 0010). O
primeiro `corpus-eval` contra o corpus real do staging mediu: depois das correções de parser,
recall@10 de 0,875 e MRR de 0,596, para gates de 0,90 e 0,70. Dos 40 casos com resposta, 17 tinham
o dispositivo certo entre a 2ª e a 12ª posição. O RRF só usa posições: um campo curto do Guia
("06 COD_SIT …") perde para o registro-pai ou para campos de nome parecido em outros registros, e a
pergunta em linguagem natural não casa bem com o texto técnico.

## Decisão

1. **`@cf/baai/bge-reranker-base` pelo Workers AI**, por REST, com o host fixo e o tratamento de
   falha do adapter de embeddings. É o único reranker do catálogo do Workers AI e usa a mesma conta
   e a mesma cota gratuita (283 neurons por milhão de tokens).
2. **40 candidatos, 12 devolvidos.** A instrução híbrida traz 40 candidatos; o reranker os ordena
   pela relevância de "rótulo de citação + conteúdo" para a pergunta, e a busca devolve os 12
   primeiros. Sem fusão com o RRF. O número saiu de uma simulação com os 50 primeiros candidatos de
   cada caso do `corpus-eval` (30, a primeira versão, dava MRR 0,656 e recall 0,900; 40 dá 0,681 e
   0,925).
3. **Degradação.** Falha do provedor ou mais de 3 s mantêm a ordem do RRF, sem falhar a pergunta;
   o resultado diz se foi reordenado. Cancelamento pelo cliente continua cancelando.
4. **`RERANKER_PROVIDER`** (`none` por padrão, ou `workers-ai`). O `corpus-eval` usa o reranker; as
   retrieval evals do PR, que rodam sem segredo e com o fake de embeddings, não.

## Consequências

- No experimento com os 12 candidatos reais de cada caso, o MRR foi de 0,596 a 0,687; 11 casos
  subiram para a 1ª posição e 6 pioraram (ex.: art. 52 do CTE, de 1º para 3º). Com 40 candidatos
  (simulação sobre o despejo do `corpus-eval`), 0,681, ainda abaixo do gate de 0,70; a melhor fusão
  com o RRF encostou em 0,700 entre 60 variantes e foi descartada como sobreajuste.
- Uma chamada a mais por pergunta (cerca de 0,9 s de mediana com 50 textos), com teto de 3 s; o
  teto de 2 s da primeira versão fazia parte das chamadas cair na ordem do RRF. A F4 mede a latência
  na rota de perguntas.
- ~3,5 neurons por pergunta, do mesmo orçamento diário da ingestão (10 mil neurons).
- O modelo foi treinado em inglês e chinês; o ganho em português foi conferido antes da decisão,
  mas perguntas muito fora do vocabulário do corpus podem piorar.

## Alternativas consideradas

- **Fusão ponderada entre RRF e reranker.** A melhor variante (peso 2) deu 0,690 contra 0,687 do
  reranker puro, com risco de sobreajuste a 40 casos.
- **Reranker de terceiros (Cohere, Jina, Voyage).** Exigiria outra conta, outro segredo e plano
  pago ou cota incerta; o Workers AI já está no orçamento.
- **Ajustes de casos isolados** (contexto da redação anterior nas revogações). Leva o recall ao
  limite, mas quase não mexe no MRR.
