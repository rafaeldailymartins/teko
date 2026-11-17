# Tasks

## 1. Porta e aplicação

- [x] 1.1 `QueryTraceStart` com `conversationId`; `RetrievalSummary` com consulta, reescrita, data,
  famílias e itens; `GenerationStart` com finalidade, versão, system e prompt; `GenerationEnd` com o
  raciocínio; `QueryTraceEnd` com as citações e o código da falha
- [x] 1.2 Raciocínio no `finish` do `LlmEvent` e repassado pelo `ProviderRouter`
- [x] 1.3 `GenerationTracker` guarda o raciocínio; resposta e reescrita mandam system, prompt e versão
- [x] 1.4 `retrievalSummary` com os itens; `StreamAnswer` e `AskQuestion` com a conversa, as
  citações e o código da falha

## 2. Adapters

- [x] 2.1 Nomes em `langfuse-names.ts`; raiz com pergunta e resposta e o contexto na metadata
- [x] 2.2 Retriever com entrada e saída; generations com mensagens OpenAI e o item `reasoning`
- [x] 2.3 Usuário, sessão, tags e metadata do trace em toda observation; nível e status do desfecho
- [x] 2.4 AI SDK: raciocínio do stream no `finish`; Gemini com `includeThoughts`; LLM fake com
  raciocínio fixo

## 3. Testes e prova

- [x] 3.1 Unitários do adapter do Langfuse, do AI SDK, do tracker, da reescrita, do pipeline e dos
  casos de uso
- [x] 3.2 Prova no Langfuse local (profile `langfuse`, `LLM_PROVIDER=fake`) com os traces auditados
  contra a página de boas práticas

## 4. Docs

- [x] 4.1 `observabilidade.md`, adendo na ADR 0012, `CONTRIBUTING.md` e runbook de queda de provedor
