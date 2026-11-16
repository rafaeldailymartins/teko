## ADDED Requirements

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
