# Proposal

## Why

Os traces do Langfuse entraram no #120 e funcionam, mas uma auditoria contra a página de boas
práticas do Langfuse ("What does a good trace look like?") achou lacunas que atrapalham quem vai
olhar e avaliar os traces: nomes sem verbo (`rag-query`, `retrieval`, `answer`, `rewrite`), a raiz
com objetos na entrada e na saída em vez da pergunta e da resposta, o retriever com a entrada vazia
e só contagens na saída, as generations sem o system prompt e fora do formato de mensagens, sem o
raciocínio do modelo, e nenhuma sessão agrupando os turnos de uma conversa. Ainda não há dashboard
nem evaluator no Langfuse, então trocar os nomes agora não quebra nada.

## What Changes

- **Nomes com verbo no início e estáveis:** trace e raiz `answer-question`, retriever
  `retrieve-context` e generations `generate-answer` e `rewrite-query`, num lugar só
  (`langfuse-names.ts`).
- **Raiz com a pergunta e a resposta:** a entrada é a pergunta redigida e a saída é a resposta em
  Markdown; data, famílias, origem, locale, desfecho, motivo da recusa e as citações (com o trecho
  e a validade) vão para a metadata. Falha sai com `ERROR`, desconexão com `WARNING` e recusa com o
  motivo na mensagem de status.
- **Retriever útil:** a entrada leva a consulta redigida, a reescrita (quando houve), a data de
  referência e as famílias; a saída leva os dispositivos recuperados (id, chave, rótulo, caminho,
  versão, vigência, RRF e posições), sem o texto, que já vai no prompt da resposta. Contagens por
  canal, modo, reranker e recusa ficam na metadata.
- **Generations como conversa:** entrada com as mensagens `system` e `user` no formato da OpenAI,
  saída como mensagem do assistente e, quando o modelo devolve raciocínio, um item `reasoning`
  antes dela; `version` com a versão do prompt (resposta ou reescrita).
- **Raciocínio capturado:** o adapter do AI SDK junta o raciocínio do stream e o entrega no
  `finish`; o Gemini passa a pedir o resumo dos pensamentos (`includeThoughts`), e o `gpt-oss` do
  Groq já o devolvia.
- **Sessão por conversa e atributos em toda observation:** `sessionId` é o id da conversa; usuário
  com hash, sessão, tags e metadata do trace vão em todas as observations (o modelo do Langfuse v4
  filtra observations sem juntar com o trace).
- Sem observation nova: as units por pergunta não mudam.

## Capabilities

### Modified Capabilities

- `llm-tracing`: nomes, entrada e saída da raiz, retriever, generations com mensagens e
  raciocínio, sessão por conversa e atributos de correlação em toda observation.

## Impact

- `apps/api`: porta `llm-tracing.ts`, `llm-port.ts` (raciocínio no `finish`), `provider-router.ts`,
  `generation-trace.ts`, `query-rewriter.ts`, `answer-pipeline.ts`, `stream-answer.ts`,
  `ask-question.ts`, adapters `langfuse.ts`, `langfuse-names.ts`, `ai-sdk-llm.ts` e o LLM fake, e
  os testes deles.
- Docs: `observabilidade.md`, adendo na ADR 0012, `CONTRIBUTING.md` e o runbook de queda de
  provedor.
- Nada muda no banco, no contrato HTTP nem nas units contadas.
