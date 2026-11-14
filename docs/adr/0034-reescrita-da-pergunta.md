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

## Adendo (2026-11-14): raciocínio mínimo e eval espaçado

A primeira medição (run 43638721503, com as chaves no environment `staging`) não valeu: o MRR do
dev caiu de 0,714 para 0,611 e o do holdout foi a 0,677, mas por duas falhas do caminho, não da
ideia.

- **Saída cortada:** o Gemini 3 e o `gpt-oss-120b` raciocinam por padrão, e os tokens de raciocínio
  contam no teto de 120: vieram consultas como "código de situação do" e "), tax". A reescrita
  passa a pedir `reasoning: 'minimal'` (o nível portátil do AI SDK 7: `thinkingLevel: minimal` no
  Gemini, `reasoning_effort: low` no Groq), com teto de 256 tokens. O prompt (`rewrite@1.1.0`)
  proíbe acrescentar nome de documento, estado ou termo genérico que a pergunta não traz.
- **Cota por minuto:** com 4 casos em paralelo, o nível gratuito respondeu 429, os breakers
  abriram e 41 de 46 reescritas do holdout falharam. Com a reescrita ligada, o `corpus-eval` roda um
  caso por vez, com 2 s entre eles, e o job ganhou 50 min. Em produção vale o mesmo limite: a
  reescrita só deve ser ligada com a cota medida contra o volume de perguntas.

## Adendo (2026-11-14): consulta só no braço léxico

Com as correções, as reescritas saíram válidas, mas o desenho da decisão 3 piorou o MRR (run
43640409545: 0,649 no dev e 0,622 no holdout). A consulta é uma lista de termos: ajuda o braço
léxico, mas o embedding e o reranker comparam frases. Eles voltam a receber a pergunta, e só o
léxico recebe a pergunta e a consulta (run 43641962158: 0,718 no dev e 0,668 no holdout, contra
0,714 e 0,654 sem reescrita). O ganho é pequeno, cabe na variação entre runs e não leva à meta de
0,70; a reescrita continua desligada até o mantenedor decidir se vale a chamada a mais ao LLM.

## Adendo (2026-11-14): eval sem reescrita por padrão

Com as chaves no environment `staging`, a decisão 5 ligava a reescrita em todo `corpus-eval`, e o
gate passou a medir uma busca diferente da que vai a produção (onde ela está desligada). Agora o
`corpus-eval` só liga a reescrita com o input `query_rewrite` do `ingest.yml` (desligado por padrão)
e as chaves; o rótulo `corpus-eval` dos PRs e o `source-watch` medem a busca de produção.
