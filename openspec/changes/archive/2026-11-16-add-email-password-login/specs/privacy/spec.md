## MODIFIED Requirements

### Requirement: Exportação dos dados

`GET /api/v1/me/export` MUST devolver, como anexo JSON, o perfil, as contas ligadas (`github`,
`google` ou `email`, sem tokens), o número de passkeys, as perguntas e o feedback do usuário, lendo
a sessão do banco. O hash da senha SHALL NOT sair na exportação.

#### Scenario: Exportação

- **WHEN** um usuário com uma pergunta respondida e feedback pede a exportação
- **THEN** o JSON traz a pergunta e o feedback, e nenhum token de sessão

#### Scenario: Conta de senha

- **WHEN** um usuário cadastrado por e-mail e senha pede a exportação
- **THEN** as contas ligadas são `["email"]`, e o JSON não traz o hash nem a senha

### Requirement: Exclusão da conta

`DELETE /api/v1/me` MUST apagar a conta e tudo o que é dela no banco numa transação (sessões, contas
OAuth e de senha com o hash, passkeys, perguntas, feedback, contadores de uso e janelas de rate
limit), apagar os cookies de sessão na resposta e pedir o apagamento nos terceiros configurados.
Depois disso, o mesmo cookie SHALL NOT exportar, perguntar nem ler perguntas do usuário, e a mesma
senha SHALL NOT entrar.

#### Scenario: Mesmo cookie depois da exclusão

- **WHEN** o usuário apaga a conta e reusa o cookie antigo em `GET /api/v1/me/export` e `POST /api/v1/questions`
- **THEN** as duas respondem 401

#### Scenario: Conta de senha apagada

- **WHEN** um usuário cadastrado por e-mail e senha apaga a conta e tenta entrar de novo com a mesma senha
- **THEN** a conta e a credencial somem do banco, e a entrada responde 401

### Requirement: Retenção

A manutenção semanal MUST apagar as perguntas com mais de 90 dias, marcar como `expired` as
`pending` com mais de 1 dia e apagar cache de respostas, janelas de rate limit (as da aplicação
vencidas e as do Better Auth paradas há mais de 1 dia), sessões e verificações vencidas.

#### Scenario: Pergunta antiga

- **WHEN** a manutenção roda com uma pergunta de 91 dias e uma `pending` de 2 dias
- **THEN** a primeira some e a segunda fica `expired`

#### Scenario: Janela velha do rate limit do Better Auth

- **WHEN** a manutenção roda com uma janela de `/sign-in/email` parada há 2 dias e outra recente
- **THEN** a primeira some e a recente fica
