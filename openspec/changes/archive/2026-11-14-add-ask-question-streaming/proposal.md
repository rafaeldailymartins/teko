# Proposal

## Why

É o coração da F4: a pergunta, a resposta em stream com citações e as proteções que mantêm o
projeto no custo zero (cotas, cache, kill switch) e dentro da LGPD (PII redigida, política
regional). O roteiro previa quatro mudanças (`add-ask-question-streaming`,
`add-llm-provider-chain`, `add-quota-guards-and-cache` e a parte de PII de `add-privacy-guards`);
elas formam um fluxo só e entram juntas, porque cada peça só tem consumidor nas outras.

## What Changes

- **Cadeia de LLM** pelo AI SDK da Vercel (decisão do mantenedor, ADR 0007): Gemini primário →
  Gemini de fallback → Groq com ZDR; breakers por modelo; fallback só antes do primeiro token;
  hosts fixos conferidos por requisição; política regional (EEE/UK/CH só com ZDR) pelo país
  declarado ou pela `geolocation()` da Vercel; fake determinístico com marcadores de falha.
- **Prompt versionado** (`PROMPT_VERSION`), fontes delimitadas e escapadas, canário, sentinela
  `INSUFICIENTE`; validação das citações `[Sn]`; saída sem HTML nem imagens, saneada também no
  stream, pedaço a pedaço.
- **`POST /api/v1/questions`**: PII redigida antes de qualquer uso; `needs_clarification`; recusa
  fora da cobertura sem LLM; cache exato; kill switch; `QuotaGuard` sob advisory lock do usuário
  (e global), com reserva de `stream_seconds`; `accepted{questionId}`.
- **`POST /api/v1/questions/:id/stream`**: claim atômico `pending → streaming` (409
  `stream_busy`), UI Message Stream v1 com heartbeat, teto próprio de 100 s (`STREAM_MAX_SECONDS`),
  desconexão abortando o LLM, finalização que grava a resposta, acerta a reserva e o cache antes do
  `finish`.
- **Histórico, detalhe, feedback e cota:** `GET /api/v1/questions?conversationId=`,
  `GET /api/v1/questions/:id`, `POST /api/v1/questions/:id/feedback`, `GET /api/v1/me/quota`.
- **`POST /api/v1/_eval/answer`** (só `APP_ENV=ci`): o pipeline inteiro sem sessão nem persistência,
  para as evals de geração e o red team.
- Drenagem fora da Vercel: perguntas e streams novos recebem 503; os ativos terminam.
- Coluna `app.questions.request_id`; env de cotas, cache, teto do stream e chaves dos provedores.

## Capabilities

### New Capabilities

- `question-answering`: pergunta, stream, cotas, cache, histórico e feedback.
- `llm-provider-chain`: cadeia de provedores, política regional, prompt e validação da saída.

## Impact

- `apps/api`: domínio (`answer-output`, `stream-sanitizer`, `cache-key`, `regional-policy`,
  `time-zone`), aplicação (pipeline, casos de uso, router, QuotaGuard, preços, prompt), adapters
  (AI SDK, fake, repositório de perguntas, geolocalização), rotas, env e testes.
- `packages/shared`: contratos de histórico, detalhe e cota.
- Catálogo: `ai`, `@ai-sdk/google`, `@ai-sdk/groq`.
- Docs: ADRs 0007 e 0019, `backend.md`, `README.md` de arquitetura, `observabilidade.md`,
  `infra/vercel/env.*.json`.
- Fora do repositório (mantenedor): `GEMINI_API_KEY`, `GROQ_API_KEY` (com ZDR ligado no console do
  Groq) e `LLM_PROVIDER=gemini` nos dois projetos da Vercel.
