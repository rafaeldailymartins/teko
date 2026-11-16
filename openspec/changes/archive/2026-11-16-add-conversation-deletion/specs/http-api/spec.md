## ADDED Requirements

### Requirement: Exclusão de uma conversa

`DELETE /api/v1/conversations/:id` MUST exigir sessão lida do banco e apagar, numa transação, todas
as perguntas do usuário da sessão naquela conversa, com as respostas, as citações e o feedback delas,
respondendo 204. Conversa inexistente ou de outro usuário SHALL dar o mesmo 404 `not_found`, sem
apagar nada.

#### Scenario: O dono exclui

- **WHEN** o usuário com uma conversa de duas perguntas, uma delas com feedback, pede `DELETE /api/v1/conversations/<id>`
- **THEN** a API responde 204, as perguntas e o feedback somem, `GET /api/v1/questions/<id da pergunta>` responde 404 e a conversa sai de `GET /api/v1/conversations`

#### Scenario: Conversa de outro usuário

- **WHEN** outro usuário pede a exclusão da conversa
- **THEN** a API responde o mesmo 404 de uma conversa que não existe, e a conversa continua lá

### Requirement: Exclusão com resposta em andamento

Com uma pergunta da conversa em stream ativo (claim há menos de 110 s), a exclusão MUST responder
409 `stream_busy` sem apagar nada. Um stream parado há mais tempo SHALL NOT impedir a exclusão.

#### Scenario: Resposta em andamento

- **WHEN** uma pergunta da conversa está em stream há 5 s e o dono pede a exclusão
- **THEN** a API responde 409 `stream_busy`, e nenhuma pergunta é apagada

### Requirement: Exclusão sem devolver a cota

A exclusão de uma conversa MUST NOT mudar o uso do dia (`usage_daily`) nem o cache de respostas:
excluir não devolve perguntas à cota, e a resposta em cache continua servindo a outros usuários.

#### Scenario: A cota fica igual

- **WHEN** o usuário que já fez três perguntas hoje exclui uma conversa com duas delas
- **THEN** `GET /api/v1/me/quota` continua mostrando três perguntas usadas

#### Scenario: Cache de outro usuário

- **WHEN** um usuário exclui a conversa cuja resposta foi para o cache, e outro faz a mesma pergunta na mesma data
- **THEN** o outro recebe a resposta do cache, sem chamar o LLM
