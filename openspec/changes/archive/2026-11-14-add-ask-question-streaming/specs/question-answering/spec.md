# Spec Delta

## Purpose

Define como o Tekó recebe uma pergunta, decide entre recusar, pedir esclarecimento, responder do
cache ou aceitar, e entrega a resposta em stream com citações, dentro das cotas do ambiente.

## ADDED Requirements

### Requirement: Pergunta redigida e recusa sem LLM

`POST /api/v1/questions` MUST exigir sessão com onboarding concluído e redigir a PII da pergunta
antes de qualquer uso. Uma data fora da cobertura SHALL ser recusada como `out_of_coverage`, gravada
no histórico, sem chamar o LLM e sem consumir cota; datas conflitantes SHALL pedir esclarecimento
sem gravar nada.

#### Scenario: Fora da cobertura

- **WHEN** um usuário pergunta sobre o RCTE em 2027-01
- **THEN** a resposta é `refused` com `out_of_coverage` e nenhuma chamada chega ao LLM

#### Scenario: PII na pergunta

- **WHEN** a pergunta traz um CPF válido e um e-mail
- **THEN** nem o payload do LLM nem `app.questions` contêm PII válida

### Requirement: Cota com reserva sob lock

Antes de aceitar uma pergunta que vai precisar de stream, a API MUST tomar o advisory lock do
usuário, conferir os tetos do dia (perguntas do usuário e globais, segundos de stream e neurons) e o
stream ativo do usuário, e reservar os segundos do teto do stream. Duas perguntas simultâneas do
mesmo usuário SHALL respeitar a cota; teto atingido SHALL dar 429 `quota_exceeded` com `meta.scope`
e `resetAt`; stream ativo SHALL dar 409 `stream_busy`.

#### Scenario: Duas abas

- **WHEN** a cota do usuário é 1 e duas perguntas dele chegam ao mesmo tempo
- **THEN** uma é aceita e a outra recebe 429 `quota_exceeded` `user_daily`

### Requirement: Cache exato e kill switch

Uma pergunta com a mesma chave (pergunta normalizada, data, `corpus_version`, versão do prompt,
família de modelo, idioma e famílias) MUST ser respondida do cache, com `meta.cached`, sem LLM e sem
cota. Com o kill switch ligado, uma pergunta sem cache SHALL receber 503 `service_paused`.

#### Scenario: Segunda vez

- **WHEN** a mesma pergunta é feita de novo depois de respondida
- **THEN** a resposta sai `answered` com `meta.cached: true`, sem nova chamada ao LLM

### Requirement: Stream único por pergunta

`POST /api/v1/questions/:id/stream` MUST exigir `Origin` do ambiente e sessão do dono, fazer o claim
atômico `pending → streaming` (sem claim, 409 `stream_busy`; pergunta de outro usuário, 404) e
responder em UI Message Stream v1 (`text/event-stream`, heartbeat a cada 15 s, `[DONE]` no fim),
com chunks válidos no `uiMessageChunkSchema` do pacote `ai`. A resposta, o acerto da reserva e o
cache SHALL ser gravados antes do `finish`.

#### Scenario: Segundo stream

- **WHEN** o stream de uma pergunta já foi aberto e o cliente pede outro
- **THEN** a API responde 409 `stream_busy`

### Requirement: Teto, desconexão e falhas do stream

O stream MUST ter teto próprio de `min(STREAM_MAX_SECONDS, prazo − agora − 20 s)`; estourado, SHALL
terminar com `error` `upstream_unavailable` retryable e a pergunta `failed`. A desconexão do cliente
MUST abortar o LLM em menos de 1 s e gravar `aborted` como tarefa pós-resposta. A cadeia fora do ar
SHALL terminar com `error` `upstream_unavailable`.

#### Scenario: Cliente sai

- **WHEN** o cliente fecha a conexão durante o texto
- **THEN** o sinal do LLM aborta em menos de 1 s e a pergunta fica `aborted`

### Requirement: Drenagem fora da Vercel

Em drenagem (SIGTERM fora da Vercel), perguntas e streams novos MUST receber 503 `service_paused`,
e os streams em andamento SHALL terminar.

#### Scenario: SIGTERM no Render

- **WHEN** o processo entrou em drenagem e chega uma pergunta nova
- **THEN** a API responde 503 `service_paused`

### Requirement: Histórico, feedback e cota

O usuário MUST ler o histórico da conversa, o detalhe de cada pergunta (inclusive para reler uma
resposta depois de uma desconexão), registrar polegar e motivo e ver a cota do dia; pergunta de
outro usuário SHALL dar 404.

#### Scenario: Feedback de outro usuário

- **WHEN** um usuário envia feedback para uma pergunta que não é dele
- **THEN** a API responde 404 `not_found`
