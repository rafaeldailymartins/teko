# web-data Specification

## Purpose

Define a camada de dados do web do Tekó: contrato com a API gerado do OpenAPI e protegido contra
drift, erros tipados a partir de Problem Details, cache por data de referência e estado do chat na
query string.

## Requirements

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

### Requirement: E-mail e senha no cliente

A camada de dados MUST expor o cadastro e a entrada por e-mail pelo `apiClient`, sem o cliente do
Better Auth, e o cadastro SHALL entrar logo depois. As falhas que a tela explica MUST chegar como
`EmailAuthError` (credenciais inválidas, conta indisponível no cadastro, senha curta ou longa, e-mail
ou nome inválido, campo recusado e limite de tentativas); rede, 403 e 5xx seguem como `ApiError`.

#### Scenario: Cadastro de um e-mail que já tem conta

- **WHEN** o cadastro responde 200 e a entrada logo depois responde 401
- **THEN** `signUpWithEmail` falha com `EmailAuthError` `accountUnavailable`

#### Scenario: Senha curta

- **WHEN** o cadastro responde 400 com `PASSWORD_TOO_SHORT`
- **THEN** `signUpWithEmail` falha com `EmailAuthError` `passwordTooShort` sem tentar entrar

### Requirement: Métodos de entrada no cliente

Os métodos de entrada ativos MUST vir de `GET /v1/auth/providers` pelo hook `useAuthProviders`, e as
mutações de e-mail e senha SHALL reler o `/me` no sucesso.

#### Scenario: Entrada concluída

- **WHEN** `useEmailSignIn` termina com sucesso
- **THEN** a consulta do `/me` fica invalidada e é relida por quem a observa

### Requirement: Exclusão de conversa no cliente

A camada de dados MUST excluir uma conversa por `DELETE /v1/conversations/:id` pelo hook
`useDeleteConversation`, com o erro como `ApiError`; 404 SHALL contar como sucesso. No sucesso, o
cache MUST tirar a conversa da lista na hora, apagar o histórico e as perguntas dela e reler a lista,
sem invalidar a cota.

#### Scenario: Excluída em outra aba

- **WHEN** a exclusão responde 404 `not_found`
- **THEN** a mutação termina com sucesso e o cache esquece a conversa

#### Scenario: Cache depois da exclusão

- **WHEN** a exclusão termina com sucesso
- **THEN** a lista em cache já não tem a conversa, as consultas do histórico e das perguntas dela saem do cache e a cota continua a mesma

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
