---

status: accepted
date: 2026-11-17
decision-makers: Rafael Daily Santos Martins
---

# 0012 — Langfuse Cloud para traces e custo de LLM

Número reservado na lista do plano ("Langfuse Cloud, a escrever na F6"; regras no
[README](README.md)). Implementada pela mudança OpenSpec `add-llm-tracing-langfuse`.

## Contexto e problema

A F6 pede, além do OTel no Grafana (traces técnicos, métricas e alertas), uma visão por pergunta do
que a resposta usou (busca, prompt, modelo, tokens, tempo até o primeiro token e custo-sombra) e o
laço de feedback do 👎 da ADR 0031. Tudo no custo zero: o Langfuse Cloud Hobby tem 50 mil units por
mês (traces, observations e scores) na organização, e a API da Vercel Hobby congela entre requisições
(nenhum timer de exportação dispara).

## Decisão

1. **Langfuse Cloud Hobby, região EU**, projetos `teko-prod` e `teko-staging`; self-hosted só no dev
   local (profile `langfuse`). A Prompt Management não é usada: os prompts vivem no repositório.
2. **SDK v6 sobre o OTel 2.x da API:** `@langfuse/otel` (`LangfuseSpanProcessor`) entra no mesmo
   `NodeTracerProvider` do Grafana por `additionalSpanProcessors`, e as observations do trace
   `rag-query` são criadas com `@langfuse/tracing`. O trace tem o mesmo `trace_id` do OTel (e do
   `x-trace-id`). O processor exporta **só os spans do SDK do Langfuse**; os spans `chat <modelo>`
   (`gen_ai.*`) ficam só no Grafana, porque a generation `answer` já carrega modelo, uso, custo de
   tabela e TTFT. Exportação em lote alcançada pelo flush por requisição; `mask` com o
   `PiiRedactor`; sem upload de mídia.
3. **Amostragem na aplicação** (`TraceSampler`): FNV-1a do `questionId`, determinístico; taxa por
   ambiente (produção 1,0, staging 0,1, CI 0) até a projeção mensal de units do ambiente
   (`usage_daily.langfuse_units`, gravada com cada trace e cada score) chegar a 35k, depois 0,2.
   Pergunta não amostrada não cria nenhuma observation.
4. **Feedback, annotation queue e apagamento pela API pública por `fetch`**, sem o
   `@langfuse/client`: ele depende do `mustache` 4.2.0, publicado sem proveniência (ADR 0002). Score
   `user_feedback` (BOOLEAN) com id estável por pergunta; 👎 vai à annotation queue
   `teko-feedback-negativo`; `DeleteMyData` apaga os traces do usuário pelo `userId` em hash.
5. **Job `langfuse` do `ops.yml`:** modelos e preços de `services/pricing.ts` (Settings → Models),
   score config e annotation queue nos dois projetos, e `teko_langfuse_units_projected` lido da
   Metrics API v2 (os dois projetos somados, que é a cota da organização), com chaves próprias no
   environment `ops`.

## Consequências

- Bom: custo por consulta e o caminho da resposta visíveis por pergunta, ligados ao "ID de suporte"
  da UI pelo `trace_id`; o 👎 chega à triagem sem trabalho manual.
- Bom: sem chaves (CI, testes), nada muda no comportamento; uma falha do Langfuse nunca chega à
  resposta (o adapter é protegido e o feedback roda em tarefa pós-resposta).
- Ruim: a projeção da API (só o próprio ambiente) e a do job (a organização) podem divergir; o
  corte da API é conservador e o alerta usa a do job.
- Com a reescrita da pergunta ligada (ADR 0034), cada provedor tentado nela vira uma generation
  `rewrite` no mesmo trace: os tokens dela aparecem no Langfuse, fora do custo-sombra da resposta, e o
  trace gasta 1 unit a mais.
- O Langfuse v4 (modelo de eventos) só lê traces pela API v2 de observations; o
  `GET /api/public/traces` responde 404. O código e a prova local usam a v2.

## Alternativas consideradas

- **Exportar também os spans `gen_ai` (padrão do SDK):** duplica tokens e custo no Langfuse e gasta
  1 ou 2 units a mais por pergunta (5 a 7 em vez de 3 a 5), o que estoura o corte com o teto diário de
  perguntas da produção.
- **Self-hosted em produção:** exigiria Postgres, ClickHouse, Redis e S3 sempre ligados; fora do
  custo zero.
- **`@langfuse/client` para scores e apagamento:** recusado pela proveniência do `mustache`.

## Adendo (2026-11-17): traces pelas boas práticas do Langfuse

Mudança OpenSpec `refine-llm-tracing-best-practices`. Uma auditoria dos traces contra a página "What
does a good trace look like?" (`langfuse.com/docs/observability/best-practices`) e a de tipos de
observation, com a prova no Langfuse local, mudou o formato do trace, não a decisão:

- **Nomes com verbo no início e estáveis:** `rag-query`, `retrieval`, `answer` e `rewrite` viraram
  `answer-question` (trace e raiz), `retrieve-context`, `generate-answer` e `rewrite-query`, num lugar
  só (`langfuse-names.ts`). Evaluators, dashboards e filtros salvos referenciam os nomes; a troca
  saiu antes de existir algum, quando era barata. Daqui em diante, trocar um nome exige refazer o que
  o referencia.
- **Raiz com a pergunta e a resposta:** a entrada e a saída do trace vêm da raiz e são o que a
  tabela, os evaluators e os experimentos leem; os objetos (data, famílias, desfecho, citações)
  foram para a metadata. As citações usadas vão com o trecho, para um evaluator de fidelidade.
- **Retriever com entrada e saída:** a consulta (e a reescrita), a data e as famílias na entrada; os
  dispositivos recuperados com RRF e posições na saída, sem o texto, que já está no prompt da
  generation (repeti-lo dobraria o tamanho do trace sem informação nova).
- **Generations como conversa:** mensagens `system` e `user` no formato da OpenAI (o system prompt,
  antes fora, entra para o trace ser fiel ao que o modelo viu; o texto é público, no repositório) e
  o raciocínio do modelo como item `reasoning` da saída, que a interface mostra como bloco
  "Thinking". O raciocínio vem no `finish` do adapter, não como evento, para o fallback do router
  continuar decidido pelo primeiro texto. O Gemini passou a pedir o resumo dos pensamentos
  (`includeThoughts`; os tokens de raciocínio já eram gastos e contados), e o `gpt-oss` do Groq já o
  devolvia.
- **Sessão = conversa:** a página recomenda sessão para chatbot. O histórico não entra no prompt
  (cada pergunta é independente), então as generations não repetem os turnos anteriores; mesmo
  assim a sessão vale: não gasta unit (é atributo), e a triagem de um 👎 vê as perguntas anteriores
  da conversa, que é onde aparece uma pergunta de continuação que falhou por falta de histórico. O id
  é o UUID interno da conversa, sem PII.
- **Atributos de correlação em toda observation** (usuário em hash, sessão, tags e metadata curta do
  trace), como o modelo de observations do Langfuse v4 pede; a versão do prompt fica no `version` de
  cada observation (a da reescrita é outra).
- Falha sai com o código do erro na mensagem de status, desconexão com `WARNING`.
- Nada disso cria observation: as units por pergunta não mudam.
