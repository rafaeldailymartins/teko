# Design

## Context

Os traces do Langfuse entraram no #120 (`add-llm-tracing-langfuse`, ADR 0012). O processor fica no
mesmo provider do OTel e exporta só os spans do SDK do Langfuse; os spans `chat <modelo>` ficam só
no Grafana (decisão mantida). A auditoria usou a skill oficial do Langfuse (`instrumentation.md`) e
as páginas buscadas de novo em 2026-11-17: `docs/observability/best-practices.md` e
`docs/observability/features/observation-types.md`.

Documentação consultada:

- Context7 `/langfuse/langfuse-docs`: `propagateAttributes` (`userId`, `sessionId`, `metadata`,
  `tags`, `version`, `traceName`) e o modelo de observations do SDK v5 em diante, em que os
  atributos de correlação vivem em toda observation; a entrada e a saída do trace vêm da raiz
  (`setActiveTraceIO` está obsoleto).
- Context7 `/websites/ai-sdk_dev`: `providerOptions.google.thinkingConfig.includeThoughts` (o
  Gemini só devolve o resumo dos pensamentos com ele) e partes `reasoning-delta` no `fullStream`;
  `reasoningFormat`/`reasoningEffort` do Groq.
- Código instalado: `@langfuse/core` 6.1.1 (`propagateAttributes` grava `user.id`, `session.id`,
  `langfuse.trace.tags` e `langfuse.trace.metadata.*` com valores string), `@ai-sdk/google` 4.0.113
  (o `includeThoughts` se junta ao `thinkingLevel` vindo do `reasoning` portátil) e `@ai-sdk/groq`
  4.0.77 (o `delta.reasoning` do `gpt-oss` vira `reasoning-delta` sem opção nenhuma).
- Código do Langfuse 4.78.0 (o mesmo do `infra/local`), `packages/shared/src/utils/chatml`: o
  adapter OpenAI reconhece `{ output: [...] }` (Responses API) e converte um item
  `{ type: "reasoning", content: [...] }` em bloco "Thinking"; `[{role, content}]` na entrada vira a
  conversa.
- OpenAPI local do Langfuse (`/generated/api/openapi.yml`): `GET /api/public/v2/observations` com
  `fields` e `expandMetadata`, usado na prova.

## Goals / Non-Goals

**Goals:** traces legíveis e avaliáveis (nomes estáveis, entrada e saída úteis, raciocínio, sessão),
sem observation nova nem mudança de units, de banco ou de contrato HTTP.

**Non-Goals:** evaluators, dashboards e Prompt Management no Langfuse; histórico de conversa no
prompt; mudar a exportação dos spans `gen_ai.*`.

## Decisions

- **Nomes num lugar só** (`langfuse-names.ts`): `answer-question`, `retrieve-context`,
  `generate-answer`, `rewrite-query`. A porta deixa de carregar nomes: a generation diz a finalidade
  (`purpose: 'answer' | 'rewrite'`) e o adapter escolhe o nome.
- **Raiz:** entrada = pergunta redigida (string), saída = resposta (string, ausente sem resposta).
  `QueryTraceEnd.citations` passou de contagem para a lista de `Citation`; a metadata leva as
  citadas com o trecho e só os ids das não citadas (o texto delas está na generation). Falha
  (`failure`, o código do erro), desconexão e recusa viram nível e mensagem de status.
- **Retriever:** `RetrievalSummary` ganhou a consulta, a reescrita, a data, as famílias e os itens
  (`RetrievedItem`); as contagens por canal passam a ser calculadas no adapter. A entrada é gravada
  no fim (a reescrita e a data só existem depois da busca); o span continua aberto do início ao fim.
- **Generations:** a porta recebe `system` e `prompt` separados e a versão do prompt; o adapter monta
  `[{role:'system'}, {role:'user'}]`. Saída: `{role:'assistant', content}` sem raciocínio; com ele,
  `{ output: [{type:'reasoning', content:[{type:'reasoning_text', text}]}, {role:'assistant', ...}] }`.
- **Raciocínio no `finish`:** o `ProviderRouter` trata o primeiro evento do modelo como o início da
  resposta (depois dele não há fallback). Como o raciocínio vem antes do texto, um evento próprio
  mudaria o fallback; o adapter do AI SDK o junta e o entrega no `finish` (`reasoning?`). O
  `GenerationTracker` o guarda e o passa ao fechar. O LLM fake devolve um raciocínio fixo, para a
  prova local.
- **Correlação em toda observation:** os mesmos atributos (`user.id`, `session.id`, tags,
  `langfuse.trace.name` e a metadata curta do trace, em strings) vão na raiz e em cada filha, direto
  no span: as filhas nascem fora do contexto assíncrono da raiz, e o `propagateAttributes` não as
  alcançaria. `prompt_version` saiu da metadata do trace: fica no `version` de cada observation.
- **Sessão:** `sessionId` = `conversationId` (UUID interno). Não gasta unit e agrupa os turnos.

## Risks / Trade-offs

- O system prompt passa a ir em cada generation (cerca de 1,5 KB a mais); units não mudam.
- O Gemini com `includeThoughts` devolve mais bytes no stream (o resumo); os tokens de raciocínio já
  eram cobrados no free tier e contados no `outputTokens`.
- O raciocínio de uma chamada interrompida no meio do stream se perde (chega só no `finish`).
- Renomear quebraria evaluators e dashboards existentes; não há nenhum ainda.

## Prova

Profile `langfuse` do `infra/local` numa stack com projeto próprio do compose (`teko-lfproof`, porta
do Postgres 55433), `LLM_PROVIDER=fake`, `QUERY_REWRITE_ENABLED=true`, seis perguntas pela API
local em duas conversas (resposta, segunda pergunta, cache, fora da cobertura, insuficiente e 429),
traces lidos pela v2 de observations e conferidos contra a página de boas práticas; a interface
local mostrou a conversa e o bloco "Thinking". Stack desmontada com `down -v`.
