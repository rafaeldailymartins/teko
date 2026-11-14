# Tasks

## 1. Cadeia de LLM

- [x] 1.1 Catálogo (`ai`, `@ai-sdk/google`, `@ai-sdk/groq`) e regra do dependency-cruiser
- [x] 1.2 `LLMPort`, adapter do AI SDK com host fixo por requisição, fake com marcadores de falha
- [x] 1.3 `ProviderRouter` com breakers, fallback antes do primeiro token e ZDR
- [x] 1.4 Política regional e `GeoResolver` (Vercel)

## 2. Prompt e saída

- [x] 2.1 Prompt versionado, fontes escapadas e canário
- [x] 2.2 Sentinela, validação das citações, saneamento e saneamento incremental do stream
- [x] 2.3 Custo-sombra

## 3. Pergunta e stream

- [x] 3.1 `AskQuestion` (PII, data, cobertura, cache, kill switch, `QuotaGuard` com advisory lock e reserva)
- [x] 3.2 `StreamAnswer` (claim, teto, desconexão, finalização) e SSE com heartbeat
- [x] 3.3 Histórico, detalhe, feedback e cota; `POST /api/v1/_eval/answer`
- [x] 3.4 Repositório de perguntas, coluna `request_id` e env

## 4. Verificação

- [x] 4.1 Unitários (domínio, router, QuotaGuard, pipeline, casos de uso, adapters)
- [x] 4.2 Integração: recusa sem LLM (espião), `Origin` → 403, `stream_busy`, cota concorrente, desconexão < 1 s, teto do stream, `lexical_only`, PII fora do payload, drenagem, kill switch, cache, contrato contra o `uiMessageChunkSchema`

## 5. Documentação

- [x] 5.1 ADRs 0007 e 0019; `backend.md`, `README.md` de arquitetura, `observabilidade.md`, `infra/vercel/env.*.json` e `status.md`
