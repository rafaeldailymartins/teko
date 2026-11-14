---

status: accepted
date: 2026-11-14
decision-makers: Rafael Daily Santos Martins
---

# 0034 — Reescrita da pergunta pelo LLM antes da busca

## Contexto e problema

A meta da F4 é MRR ≥ 0,70 no `holdout` do `corpus-eval`. O contexto do dispositivo-pai no
reranker (adendo da ADR 0027) levou o holdout de 0,475 para 0,654. As falhas restantes
([registro](../evals/mrr-f4-2026-11-14.md)) são de vocabulário: a pergunta vem na linguagem de
contador ou em inglês, e o corpus está na da lei e dos leiautes. Tradução automática (`m2m100`) e
contexto do pai no braço léxico foram medidos e não melhoraram. O roteiro prevê a reescrita da
pergunta pelo LLM antes da busca.

## Decisão

1. **Reescrita pela cadeia de LLM da resposta** (ADR 0007), num `ProviderRouter` único para as
   duas chamadas: mesmos breakers, mesma política regional (só ZDR para EEE, Reino Unido e Suíça) e
   a pergunta já redigida, sem PII.
2. **Prompt `rewrite@1.0.0`** (versionado como o da resposta): uma linha em português, com o
   vocabulário da legislação e dos leiautes, mantendo números, datas e códigos, sem responder nem
   inventar dispositivos. A pergunta vai escapada entre `<pergunta>` e `</pergunta>`, como dado.
   Temperatura 0, até 120 tokens, teto de 4 s.
3. **Uso na busca:** o braço léxico recebe a pergunta e a consulta (OU dos lexemas das duas); o
   embedding e o reranker, a consulta; as referências citadas saem das duas. O resultado da busca
   traz a consulta, e o relatório do eval a grava.
4. **Degradação:** falha da cadeia, teto ou saída vazia seguem com a pergunta original; só o
   cancelamento do cliente propaga. A recusa fora da cobertura vem antes, sem chamar o LLM.
5. **Desligada por padrão** (`QUERY_REWRITE_ENABLED`, que exige `LLM_PROVIDER`). O `corpus-eval`
   liga a reescrita quando o environment `staging` do GitHub tem `GEMINI_API_KEY` e
   `GROQ_API_KEY` (ou só a do Groq). Staging e produção só a ligam depois da medição: MRR ≥ 0,70
   no holdout e sem regressão no dev.

## Consequências

- Bom: ataca o vão de vocabulário sem provedor, conta nem segredo novos, e a medição sai do mesmo
  `corpus-eval`, com a consulta de cada caso no relatório.
- Ruim: uma chamada a mais ao LLM por pergunta com evidência (no pior caso, metade da cota diária
  do Gemini free) e cerca de 0,5–1 s antes do primeiro token.
- Ruim: os tokens da reescrita não entram no custo-sombra da resposta; o Langfuse (F6) os mostra.
- Neutro: o fake de LLM devolve a própria pergunta para o prompt de reescrita, então a stack de CI e
  os testes de integração exercitam o caminho sem mudar a busca.

## Confirmação

- Unitários do prompt, do `QueryRewriter` (ZDR, falha, teto, cancelamento) e do `HybridSearch`
  (texto de cada braço, referências das duas versões, degradação).
- Integração: reescrita ligada com o fake (duas chamadas, sem PII, resposta gravada) e recusa fora
  da cobertura sem chamada.
- `corpus-eval` com as chaves no environment `staging` (pendente do mantenedor).

## Mais informações

- [ADR 0007](0007-cadeia-de-llm.md) (cadeia de LLM), [ADR 0027](0027-reranker-workers-ai.md)
  (reranker e adendo do contexto do pai), [ADR 0031](0031-ragops-avaliacao-e-gates.md)
  (`corpus-eval` e holdout).
- Sem biblioteca nova; a chamada usa a porta `LlmModel` e o AI SDK já fixados na ADR 0007.
