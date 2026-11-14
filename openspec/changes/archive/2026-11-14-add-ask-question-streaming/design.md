# Design

## Context

O desenho está em `docs/architecture/backend.md` ("Pergunta e streaming" e "LLM, PII, prompt e
tetos"). O que este documento registra são as escolhas de implementação e os pontos em que o
código diverge ou detalha o desenho.

## Decisions

- **Pipeline sem persistência** (`answer-pipeline.ts`): data → cobertura → busca → prompt → cadeia
  → validação, gerando os chunks e entregando o resultado por callback. O stream o embrulha com
  claim, teto e gravação; a rota de eval só coleta. Uma implementação só para os dois.
- **Advisory lock do usuário e o global** na reserva: o do usuário garante que duas abas não passem
  juntas pelo `QuotaGuard`; o global impede que duas pessoas estourem o teto global ao mesmo tempo.
  A transação é curta (leitura do uso, `INSERT … ON CONFLICT` e a pergunta), então serializar as
  reservas não pesa.
- **Saneamento incremental do stream**: cada `text-delta` sai já sem HTML nem imagens e com as
  citações em links `cite:`; a marcação incompleta mais antiga fica retida até fechar (ou 300
  caracteres), e o fim do buffer fica retido no tamanho do canário. A propriedade testada: qualquer
  partição do texto produz o mesmo resultado que o saneamento do texto inteiro.
- **Citações:** todas as fontes saem como `data-citation` válidas quando o modelo começa; no fim, as
  que a resposta não citou são reenviadas com `valid: false`. Sem nenhuma citação válida, recusa
  `citation_invalid`. Marcadores de fontes inexistentes saem do texto gravado.
- **Canário vazado** vira recusa `model_insufficient` (nada mais sai do stream).
- **Refusa no stream sem `data-meta`:** quando a busca recusa (sem evidência), o modelo não começa e
  o `data-meta` (que exige o provedor) não sai; o `finish` leva `model: none`.
- **Desconexão:** o sinal da resposta é `AbortSignal.any([desconexão, teto])`; a desconexão não
  emite `error` (ninguém lê) e grava `aborted` em `BackgroundTasks`. O teto emite `error`
  `upstream_unavailable` retryable e grava `failed`.
- **Reserva acertada no dia da pergunta** (`created_at` em São Paulo), não no dia da finalização.
- **Prompt em TypeScript** e preços em `services/pricing.ts`, para entrar no bundle do tsdown.
- **SSE por `PassThrough`**, com heartbeat por `setInterval` e a iteração parando quando o stream
  de saída é destruído (o `return()` do gerador grava o `aborted`).
- **Override de embeddings e de modelos no container**, para os testes de degradação
  (`lexical_only`) e para o espião que prova "nenhuma PII no payload" e "desconexão < 1 s".

## Risks / Trade-offs

- Os IDs dos modelos (`gemini-3.6-flash`, `gemini-3.5-flash-lite`, `openai/gpt-oss-120b`) vêm do
  desenho e ficam no env; um modelo descontinuado só aparece no primeiro uso real, e o breaker cai
  para o seguinte.
- O `maxOutputTokens` de 1.200 pode incluir raciocínio em modelos que pensam; sem `thinkingConfig`
  explícito, a F8 mede nas evals de geração.
- O fake não exercita o parser SSE real dos provedores; os testes do adapter usam os provedores do
  AI SDK com um `fetch` falso, no formato SSE do Gemini e do Groq.

## Context7

| Biblioteca | ID                     | Consulta                                                                            |
| ---------- | ---------------------- | ----------------------------------------------------------------------------------- |
| AI SDK     | `/websites/ai-sdk_dev` | `streamText` com `abortSignal`, `maxOutputTokens`, `maxRetries`, `fullStream` e uso |
| AI SDK     | `/websites/ai-sdk_dev` | `createGoogle`/`createGroq` com `baseURL` e `fetch`; `APICallError` e `retry-after` |
| AI SDK     | `/websites/ai-sdk_dev` | `uiMessageChunkSchema` e validação do UI Message Stream                             |
