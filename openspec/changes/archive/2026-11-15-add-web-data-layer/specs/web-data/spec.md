# Spec Delta

## ADDED Requirements

### Requirement: Contrato versionado e cliente gerado

O web MUST falar com a API só pelo cliente gerado de `apps/web/openapi.json`. O documento SHALL sair
da própria API (rotas e schemas Zod), sem servidor nem banco, e ser determinístico: caminhos relativos
a `servers: [{ url: '/api' }]`, `info.version` fixo, ordem estável e nada que mude de build para
build. O CI MUST regenerar o documento e o cliente e falhar se algum dos dois diferir do que está no
git.

#### Scenario: Rota nova sem regenerar

- **WHEN** um PR muda o schema de uma rota da API e não roda `pnpm --filter @teko/web api:generate`
- **THEN** o `pnpm api:check` do job `lint` falha e lista os arquivos com drift

#### Scenario: Duas gerações seguidas

- **WHEN** o OpenAPI é exportado duas vezes, com versões de build diferentes no ambiente
- **THEN** os dois arquivos são idênticos byte a byte

### Requirement: Erro tipado da API

Toda falha de uma chamada do cliente gerado MUST chegar à UI como `ApiError`, com `code` do conjunto
fechado de `ErrorCode`, `retryable` de `ERROR_CODE_SPECS` e o `traceId` do Problem Details quando a
API respondeu. Resposta de erro sem Problem Details válido SHALL ter o código derivado do status HTTP;
falha de rede SHALL ser `internal`, repetível e sem status. Os catálogos `en` e `pt-BR` MUST ter uma
mensagem `errors.<code>` para cada `ErrorCode`.

#### Scenario: Sessão expirada

- **WHEN** a API responde 401 com Problem Details `unauthenticated`
- **THEN** a consulta falha com `ApiError` de `code` `unauthenticated`, `retryable` falso e o
  `traceId` do corpo, e a UI mostra `errors.unauthenticated`

#### Scenario: Gateway da plataforma

- **WHEN** a resposta é um 502 em HTML, sem Problem Details
- **THEN** a consulta falha com `ApiError` de `code` `internal` e `status` 502

### Requirement: Cache por data de referência

As consultas MUST usar um `QueryClient` com `staleTime` de 60 s e repetir só erros transitórios
(nunca `quota_exceeded` nem `rate_limited`). Quando a resposta depende da data de referência, a data
efetiva (o período de apuração resolve para o dia 1) MUST ir explícita na requisição e, com ela, na
query key.

#### Scenario: Período e dia 1

- **WHEN** a paleta busca o mesmo texto com o período `2024-03` e depois com a data `2024-03-01`
- **THEN** as duas buscas usam a mesma entrada do cache, e a busca com `2024-04` usa outra

### Requirement: Estado do chat na URL

O chat MUST guardar a pergunta (`q`), a conversa (`c`) e a data de referência (`ref`) na query string
(`/pt-BR/chat/?q=<questionId>&c=<conversationId>&ref=2024-03`). `q` e `c` SHALL aceitar só UUID;
`ref` SHALL aceitar período `AAAA-MM` ou data `AAAA-MM-DD` válidos pelos schemas de
`@teko/shared/vigencia`. Valor inválido SHALL ser descartado, sem erro.

#### Scenario: Data inexistente na URL

- **WHEN** a URL traz `ref=2023-02-29`
- **THEN** o estado fica sem data de referência, e a pergunta segue com `source: 'default'`
