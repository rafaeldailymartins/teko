# Design

## Context

Cota do nível gratuito medida em 2026-11-14 (`docs/status.md`) e decisão do mantenedor em
2026-11-15 (ADR 0007, adendo).

## Decisions

- **Lite primeiro.** Qualquer ordem soma 520 pedidos por dia no Gemini; com o Lite na frente, o
  Flash fica de reserva para picos o dia todo, em vez de se esgotar nas primeiras 20 perguntas.
- **Cota pelo corpo do 429.** O Gemini responde `google.rpc.Status` com `QuotaFailure` (o `quotaId`
  da cota diária contém `PerDay`) e `RetryInfo` (`retryDelay` como `"37s"`). O adapter lê o
  `responseBody` do `APICallError` (o `data` do provedor Google só guarda `code`, `message` e
  `status`). O `retry-after` do header, que o Groq manda, tem precedência sobre o `retryDelay`.
- **Sem prazo, 60 s.** Um 429 sem informação passa a abrir o breaker pelo mesmo tempo das falhas
  5xx: tentar de novo custa uma chamada recusada, e fechar o modelo o dia todo custava a cota inteira.

## Risks / Trade-offs

- Se o Google mudar o `quotaId`, a cota diária vira um 429 de 60 s: o modelo é tentado de novo a
  cada minuto até a meia-noite, com uma chamada recusada por minuto.

## Context7

- `/websites/ai_google_dev_gemini-api`: limites por projeto, renovação à meia-noite do Pacífico e
  formato do erro (`google.rpc.Status`).
- `/llmstxt/console_groq_llms-full_txt`: `retry-after` em segundos no 429 do Groq.
