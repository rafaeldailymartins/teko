## MODIFIED Requirements

### Requirement: Excluir uma conversa

Cada conversa do histórico, no painel do chat e na página `/[locale]/history/`, MUST ter um menu "⋯"
com "Excluir conversa", visível no hover e no foco da linha e sempre visível no toque. A ação SHALL
pedir confirmação num diálogo de alerta com o título da conversa, o aviso de que não dá para desfazer e
um botão destrutivo; cancelar MUST devolver o foco ao "⋯".

#### Scenario: Excluir pela lista

- **WHEN** o usuário abre o "⋯" de uma conversa em `/pt-BR/history/`, escolhe "Excluir conversa" e confirma
- **THEN** a conversa some da lista e o aviso "Conversa excluída." aparece

#### Scenario: Cancelar

- **WHEN** o usuário abre a confirmação e escolhe "Cancelar"
- **THEN** nada é apagado, e o foco volta ao "⋯" da conversa

