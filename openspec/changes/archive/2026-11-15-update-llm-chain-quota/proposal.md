# Proposal

## Why

A cota gratuita medida em 2026-11-14 (Gemini 3.6 Flash com 5 pedidos por minuto e 20 por dia; Flash
Lite com 15 e 500) não sustenta o Flash como primário: as 20 primeiras perguntas do dia esgotam a
cota dele. E o breaker abria até a meia-noite do Pacífico em todo 429 sem `retry-after`, que o
Gemini nunca manda: um pico de 6 perguntas num minuto tirava o modelo do dia inteiro.

## What Changes

- A cadeia passa a `gemini-3.5-flash-lite` → `gemini-3.6-flash` → `openai/gpt-oss-120b` (padrões do
  env, `infra/vercel` e `infra/planb-render`).
- O 429 da cota diária abre o breaker até a meia-noite do Pacífico; outro 429 abre pelo
  `retry-after` ou pelo `retryDelay` do corpo do Gemini e, sem prazo, por 60 s.

## Capabilities

### Modified Capabilities

- `llm-provider-chain`: regra do breaker no 429.

## Impact

- `apps/api`: `LlmError`, `ProviderRouter`, adapter do AI SDK e padrões do env; ADR 0007 (adendo),
  `backend.md` e `status.md`.
