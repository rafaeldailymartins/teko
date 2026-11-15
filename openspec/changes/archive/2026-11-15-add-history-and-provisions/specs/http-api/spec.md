# Spec Delta

## ADDED Requirements

### Requirement: Lista de conversas do usuário

`GET /api/v1/conversations` MUST exigir sessão e listar só as conversas do usuário da sessão, da
última pergunta mais recente para a mais antiga. Cada item SHALL trazer `conversationId`, o título
derivado da primeira pergunta redigida (uma linha, até 80 caracteres), a contagem de perguntas, o
instante da última pergunta e a data de referência dela. A resposta SHALL sair com
`Cache-Control: private, no-store` e passar pelo rate limit da aplicação.

#### Scenario: Conversas de outro usuário

- **WHEN** outro usuário pede a lista
- **THEN** nenhuma conversa do primeiro aparece

#### Scenario: Depois da exclusão da conta

- **WHEN** o usuário apaga a conta e reusa o cookie antigo em `GET /api/v1/conversations`
- **THEN** a API responde 401

### Requirement: Paginação da lista de conversas por cursor

A lista de conversas MUST vir em páginas de 20, com `nextCursor` opaco (`null` na última página) e
empate de instante resolvido pelo id da conversa. A paginação MUST NOT repetir nem pular conversas,
inclusive quando os instantes só diferem nos microssegundos. Cursor que a API não emitiu ou
parâmetro desconhecido SHALL dar 400 `validation_error`.

#### Scenario: Duas páginas

- **WHEN** o usuário tem 25 conversas e pede a primeira página e depois a do `nextCursor`
- **THEN** recebe 20 e depois 5 conversas, sem repetição, e o `nextCursor` da segunda é `null`

#### Scenario: Cursor inventado

- **WHEN** chega `GET /api/v1/conversations?cursor=bad`
- **THEN** a API responde 400 `validation_error`, sem consultar as perguntas
