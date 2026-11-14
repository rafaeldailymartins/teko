# Proposal

## Why

O Tekó guarda dados pessoais (conta, perguntas redigidas, feedback) e precisa cumprir os direitos
do titular da LGPD e a retenção de 90 dias das conversas. A redação de PII antes do LLM entrou com o
fluxo de pergunta (`add-ask-question-streaming`); faltam a exportação, a exclusão, o expurgo semanal
e o registro de tratamento.

## What Changes

- `GET /api/v1/me/export`: perfil, contas ligadas (sem tokens), passkeys, perguntas e feedback, como
  anexo JSON, com rate limit.
- `DELETE /api/v1/me`: apaga a conta e, por cascata, tudo o que é dela, mais os contadores de uso e
  as janelas de rate limit; apaga os cookies de sessão; pede o apagamento nos terceiros (porta
  `ErasurePort`, ligada a PostHog e Langfuse na F6).
- As rotas de DSR e a pergunta leem a sessão do banco: uma sessão revogada não lê nem grava dados.
- `PurgeExpiredData` e `cli maintenance purge`: perguntas com mais de 90 dias, `pending` com mais de
  1 dia viram `expired`, e cache, janelas de rate limit, sessões e verificações vencidas saem.
- `docs/privacy/ropa.md`: registro das operações de tratamento, com a janela de 5 min do
  `cookieCache`.

## Capabilities

### New Capabilities

- `privacy`: exportação, exclusão, sessão revogada e retenção.

## Impact

- `apps/api`: casos de uso de privacidade, repositórios de conta e manutenção, rotas `/me`, CLI,
  `AuthGateway` (cookies a apagar) e testes.
- `packages/shared`: contrato da exportação.
- Docs: `docs/privacy/ropa.md`, `backend.md`, `status.md`.
- O agendamento semanal (`weekly-maintenance` do `ops.yml`) é da F6, que cria o `ops.yml`.
