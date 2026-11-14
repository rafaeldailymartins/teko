# Design

## Context

A busca (ADR 0010, 0027) usa a pergunta como veio. O `corpus-eval` de 2026-11-14
([registro](../../../docs/evals/mrr-f4-2026-11-14.md)) mostrou que tradução automática (`m2m100`)
e contexto do pai no léxico não fecham o vão de vocabulário.

## Decisions

- **A mesma cadeia da resposta**, por um `ProviderRouter` único: os breakers valem para as duas
  chamadas, e a política regional (só ZDR para EEE/UK/CH) também. Sem provedor novo.
- **Consulta, não resposta:** o prompt pede uma linha em português, com o vocabulário da lei,
  mantendo números, datas e códigos, sem responder nem inventar dispositivos; a pergunta vai
  escapada entre `<pergunta>` e `</pergunta>`, como dado.
- **Léxico com as duas versões** (OU dos lexemas): a reescrita só acrescenta termos ao braço que
  depende de vocabulário; embedding e reranker recebem a consulta, mais próxima do texto do corpus.
- **Degradação silenciosa:** falha da cadeia, 4 s ou saída vazia seguem com a pergunta; só o
  cancelamento do cliente propaga. A recusa fora da cobertura vem antes da busca, então nem a
  reescrita chama o LLM.
- **Desligada por padrão** (`QUERY_REWRITE_ENABLED`): entra em staging e produção só depois de o
  `corpus-eval` medir o ganho no holdout sem regressão no dev.

## Risks / Trade-offs

- Uma chamada a mais ao LLM por pergunta com evidência: cota diária do Gemini free dividida por
  dois no pior caso, e cerca de 0,5–1 s a mais antes do primeiro token.
- Os tokens da reescrita não entram no custo-sombra da resposta (aparecem no Langfuse na F6).

## Context7

Sem biblioteca nova: a chamada usa a porta `LlmModel` e o AI SDK já fixados na ADR 0007.
