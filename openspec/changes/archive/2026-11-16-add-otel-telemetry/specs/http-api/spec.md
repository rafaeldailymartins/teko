## ADDED Requirements

### Requirement: ID de rastreio em toda resposta

Toda resposta da API MUST trazer o header `x-trace-id` com o `trace_id` W3C (32 hex) da requisição:
o do span da requisição ou, sem telemetria, o do `traceparent` recebido ou um id aleatório no mesmo
formato. O `traceId` dos Problem Details e o do `finish` do stream SHALL ter o mesmo valor.

#### Scenario: Erro com Problem Details

- **WHEN** `GET /api/v1/questions/<id-inexistente>` responde 404 com `traceparent` enviado
- **THEN** o header `x-trace-id` e o `traceId` do corpo são o `trace_id` do `traceparent`

#### Scenario: Sem traceparent

- **WHEN** uma requisição a `/api` chega sem `traceparent`
- **THEN** a resposta traz `x-trace-id` com 32 caracteres hexadecimais
