## ADDED Requirements

### Requirement: Menu de idioma

A troca de idioma MUST ser um menu suspenso com ícone, como o seletor de tema, com os idiomas pelo
nome nativo (o atual marcado), no cabeçalho do site, no do app e nas configurações. Cada idioma
SHALL levar à mesma página no outro locale com a query e a âncora atuais, por navegação completa
(o `<html lang>` muda). Fora de um locale, o destino SHALL ser a inicial do idioma, sem a query.

#### Scenario: Conversa aberta em outro idioma

- **WHEN** o usuário em `/pt-BR/chat/?c=<id>&ref=2024-03` escolhe English no menu de idioma
- **THEN** o navegador vai para `/en/chat/?c=<id>&ref=2024-03`

#### Scenario: Seção da política

- **WHEN** o usuário em `/pt-BR/privacy/#retention` escolhe English
- **THEN** o navegador vai para `/en/privacy/#retention`
