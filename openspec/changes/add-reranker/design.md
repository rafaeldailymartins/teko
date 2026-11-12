# Design

## Context

A busca híbrida (ADR 0010) funde três braços por RRF e devolve 12 evidências. O RRF só usa
posições: um campo curto do Guia ("06 COD_SIT …") perde para o registro-pai ou para campos de nome
parecido em outros registros, e a pergunta em linguagem natural ("quais códigos de situação…") não
casa bem com o texto técnico. Um reranker compara a pergunta com cada texto diretamente.

## Decisions

- **`@cf/baai/bge-reranker-base` pelo Workers AI.** É o único reranker do catálogo do Workers AI e
  roda na mesma conta e cota dos embeddings (283 neurons por milhão de tokens: 30 candidatos de
  ~300 tokens dão ~2,5 neurons por pergunta). O modelo foi treinado em inglês e chinês; o
  experimento com os candidatos reais em português confirmou o ganho antes da implementação.
- **REST, host fixo.** `POST https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/@cf/baai/bge-reranker-base`
  com `{ query, contexts: [{ text }] }`; resposta `{ result: { response: [{ id, score }] } }`. A
  URL do endpoint é montada pela mesma função do adapter de embeddings, com o modelo como parâmetro.
- **30 candidatos, 12 devolvidos.** O reranker só reordena; ele não traz candidato que a instrução
  híbrida não trouxe. Com 30, os casos que ficam entre a 13ª e a 30ª posição podem entrar no
  top-12. O custo da instrução não muda: os braços já trazem 50 candidatos cada.
- **Texto do candidato: rótulo de citação e conteúdo.** O rótulo ("Guia Prático EFD-ICMS/IPI,
  Registro C100, Campo 06 (COD_SIT)") dá o contexto que o conteúdo do campo não tem, sem mudar a
  instrução SQL.
- **Ordem do reranker pura, sem fusão com o RRF.** No experimento, a melhor fusão (RRF da posição
  original com a do reranker, peso 2) deu 0,690 contra 0,687 do reranker puro; ajustar pesos a 40
  casos seria sobreajuste.
- **Degradação.** Erro de rede ou HTTP, resposta inesperada ou mais de 2 s → a ordem do RRF, os 12
  primeiros, `reranked: false`. Cancelamento pelo cliente continua cancelando.

## Risks / Trade-offs

- **Latência.** Uma chamada a mais por pergunta (estimativa: 150 a 400 ms do `gru1` ao Cloudflare),
  com teto de 2 s. A F4 mede no orçamento de latência da rota.
- **Neurons.** ~2,5 por pergunta, do mesmo orçamento diário da ingestão. Com 10 mil neurons por
  dia, cabem milhares de perguntas; a ingestão já para no código 75 quando o orçamento acaba.
- **Regressões pontuais.** O reranker piorou 6 dos 40 casos no experimento (ex.: art. 52 do CTE de
  1º para 3º). O gate do `corpus-eval` mede o efeito líquido.

## Context7

| Biblioteca            | ID                                                        | Consulta                                                     |
| --------------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| Cloudflare Workers AI | `/llmstxt/developers_cloudflare_workers-ai_llms-full_txt` | `bge-reranker-base`: entrada, saída, REST e preço em neurons |
