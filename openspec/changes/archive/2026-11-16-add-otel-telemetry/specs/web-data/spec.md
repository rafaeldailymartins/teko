## MODIFIED Requirements

### Requirement: Erro tipado da API

Toda falha de uma chamada do cliente gerado MUST chegar à UI como `ApiError`, com `code` de
`ErrorCode`, `retryable` de `ERROR_CODE_SPECS` e o `traceId` (do Problem Details ou, sem ele, do
header `x-trace-id`) quando a API respondeu. Sem Problem Details válido, o código SHALL vir do status
HTTP; falha de rede SHALL ser `internal`, repetível e sem status. Os catálogos `en` e `pt-BR` MUST ter
`errors.<code>` para cada `ErrorCode`.

#### Scenario: Sessão expirada

- **WHEN** a API responde 401 com Problem Details `unauthenticated`
- **THEN** a consulta falha com `ApiError` de `code` `unauthenticated`, `retryable` falso e o
  `traceId` do corpo, e a UI mostra `errors.unauthenticated`

#### Scenario: Gateway da plataforma

- **WHEN** a resposta é um 502 em HTML, sem Problem Details
- **THEN** a consulta falha com `ApiError` de `code` `internal` e `status` 502

#### Scenario: ID de suporte pelo header

- **WHEN** a resposta de erro não traz Problem Details, mas traz `x-trace-id`
- **THEN** o `ApiError` tem esse valor como `traceId`, e a tela mostra "ID de suporte: <valor>"

## ADDED Requirements

### Requirement: ID de suporte nas mensagens de erro

As telas que mostram um erro da API, incluindo o chat, SHALL mostrar o "ID de suporte" ("Support ID"
em `en`) quando o `ApiError` ou a resposta do stream trouxer um, sem mudar a mensagem do erro.

#### Scenario: Erro no meio do stream

- **WHEN** o stream termina com um chunk `error` `upstream_unavailable`
- **THEN** o aviso do chat mostra a mensagem do erro e "ID de suporte: <x-trace-id do stream>"

### Requirement: traceparent por requisição

Cada requisição do web a `/api` (o cliente gerado e o stream do chat) MUST levar um header
`traceparent` W3C novo (versão `00`, flag `sampled` `00`), sem SDK de OpenTelemetry no navegador e sem
mudar a CSP (o header vai para a mesma origem).

#### Scenario: Pergunta pelo chat

- **WHEN** o usuário envia uma pergunta que abre o stream
- **THEN** o `POST /api/v1/questions` e o `POST /api/v1/questions/:id/stream` levam `traceparent`
  diferentes, e um chunk `error` do stream mostra o `x-trace-id` da resposta do stream como "ID de
  suporte"
