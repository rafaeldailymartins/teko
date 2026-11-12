# Design

## Context

A busca híbrida (ADR 0010) funde três braços por RRF e devolve 12 evidências. O RRF só usa
posições: um campo curto do Guia ("06 COD_SIT …") perde para o registro-pai ou para campos de nome
parecido em outros registros, e a pergunta em linguagem natural ("quais códigos de situação…") não
casa bem com o texto técnico. Um reranker compara a pergunta com cada texto diretamente.

## Decisions

- **`@cf/baai/bge-reranker-base` pelo Workers AI.** É o único reranker do catálogo do Workers AI e
  roda na mesma conta e cota dos embeddings (283 neurons por milhão de tokens: 40 candidatos dão
  ~3,5 neurons por pergunta). O modelo foi treinado em inglês e chinês; o
  experimento com os candidatos reais em português confirmou o ganho antes da implementação.
- **REST, host fixo.** `POST https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/@cf/baai/bge-reranker-base`
  com `{ query, contexts: [{ text }] }`; resposta `{ result: { response: [{ id, score }] } }`. A
  URL do endpoint é montada pela mesma função do adapter de embeddings, com o modelo como parâmetro.
- **40 candidatos, 12 devolvidos.** O reranker só reordena; ele não traz candidato que a instrução
  híbrida não trouxe. O custo da instrução não muda: os braços já trazem 50 candidatos cada. O
  número saiu de uma simulação com o despejo do `corpus-eval` (run 43282477443): os 50 primeiros
  candidatos de cada caso, na ordem do RRF, pontuados uma vez pelo reranker (a nota de cada par
  pergunta-texto é independente):

  | Candidatos           | MRR   | recall@10 |
  | -------------------- | ----- | --------- |
  | sem reranker         | 0,596 | 0,875     |
  | 12                   | 0,681 | 0,875     |
  | 20                   | 0,667 | 0,875     |
  | 30 (primeira versão) | 0,656 | 0,900     |
  | 40                   | 0,681 | 0,925     |
  | 50                   | 0,681 | 0,925     |

  40 dá o melhor recall com o MRR do topo da curva, com menos texto que 50.
- **Texto do candidato: rótulo de citação e conteúdo.** O rótulo ("Guia Prático EFD-ICMS/IPI,
  Registro C100, Campo 06 (COD_SIT)") dá o contexto que o conteúdo do campo não tem, sem mudar a
  instrução SQL.
- **Ordem do reranker pura, sem fusão com o RRF.** Na simulação com 50 candidatos, a melhor de 60
  variações de fusão (sigmoide da nota mais um peso na posição do RRF) deu exatamente 0,700, e as
  vizinhas, de 0,68 a 0,69, o mesmo que o reranker puro: escolher a variante que encosta no gate
  entre 60 testadas nos mesmos 40 casos seria sobreajuste.
- **Degradação.** Erro de rede ou HTTP, resposta inesperada ou mais de 3 s → a ordem do RRF, os 12
  primeiros, `reranked: false`. Cancelamento pelo cliente continua cancelando. O teto começou em
  2 s; com 50 textos a chamada levou 892 ms de mediana e 2,5 s no máximo, e as que estouravam
  caíam na ordem do RRF (o MRR do `corpus-eval` variou de 0,639 a 0,673 entre runs iguais).

## Risks / Trade-offs

- **Latência.** Uma chamada a mais por pergunta (cerca de 0,9 s de mediana com 50 textos, medida
  de fora da Cloudflare), com teto de 3 s. A F4 mede no orçamento de latência da rota.
- **MRR abaixo do gate.** Mesmo com 40 candidatos, a simulação dá 0,681 contra o gate de 0,70 do
  `corpus-eval`: o reranker sozinho não fecha a distância.
- **Neurons.** ~3,5 por pergunta, do mesmo orçamento diário da ingestão. Com 10 mil neurons por
  dia, cabem milhares de perguntas; a ingestão já para no código 75 quando o orçamento acaba.
- **Regressões pontuais.** O reranker piorou 6 dos 40 casos no experimento (ex.: art. 52 do CTE de
  1º para 3º). O gate do `corpus-eval` mede o efeito líquido.

## Context7

| Biblioteca            | ID                                                        | Consulta                                                     |
| --------------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| Cloudflare Workers AI | `/llmstxt/developers_cloudflare_workers-ai_llms-full_txt` | `bge-reranker-base`: entrada, saída, REST e preço em neurons |
