# Spec Delta

## Purpose

Define como o Tekó atende os direitos do titular (acesso, portabilidade e exclusão) e mantém a
retenção dos dados pessoais.

## ADDED Requirements

### Requirement: Exportação dos dados

`GET /api/v1/me/export` MUST devolver, como anexo JSON, o perfil, os provedores OAuth ligados (sem
tokens), o número de passkeys, as perguntas e o feedback do usuário, lendo a sessão do banco.

#### Scenario: Exportação

- **WHEN** um usuário com uma pergunta respondida e feedback pede a exportação
- **THEN** o JSON traz a pergunta e o feedback, e nenhum token de sessão

### Requirement: Exclusão da conta

`DELETE /api/v1/me` MUST apagar a conta e tudo o que é dela no banco numa transação (sessões, contas
OAuth, passkeys, perguntas, feedback, contadores de uso e janelas de rate limit), apagar os cookies
de sessão na resposta e pedir o apagamento nos terceiros configurados. Depois disso, o mesmo cookie
SHALL NOT exportar, perguntar nem ler perguntas do usuário.

#### Scenario: Mesmo cookie depois da exclusão

- **WHEN** o usuário apaga a conta e reusa o cookie antigo em `GET /api/v1/me/export` e `POST /api/v1/questions`
- **THEN** as duas respondem 401

### Requirement: Retenção

A manutenção semanal MUST apagar as perguntas com mais de 90 dias, marcar como `expired` as
`pending` com mais de 1 dia e apagar cache de respostas, janelas de rate limit, sessões e
verificações vencidas.

#### Scenario: Pergunta antiga

- **WHEN** a manutenção roda com uma pergunta de 91 dias e uma `pending` de 2 dias
- **THEN** a primeira some e a segunda fica `expired`
