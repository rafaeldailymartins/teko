## ADDED Requirements

### Requirement: Excluir uma conversa

Cada conversa do histórico, no painel do chat e na página `/[locale]/history/`, MUST ter um menu "⋯"
com "Excluir conversa", visível no hover e no foco da linha e sempre visível no toque. A ação SHALL
pedir confirmação num diálogo de alerta com o título da conversa, o aviso de que não dá para desfazer
e de que a cota não volta, e um botão destrutivo; cancelar MUST devolver o foco ao "⋯".

#### Scenario: Excluir pela lista

- **WHEN** o usuário abre o "⋯" de uma conversa em `/pt-BR/history/`, escolhe "Excluir conversa" e confirma
- **THEN** a conversa some da lista e o aviso "Conversa excluída." aparece

#### Scenario: Cancelar

- **WHEN** o usuário abre a confirmação e escolhe "Cancelar"
- **THEN** nada é apagado, e o foco volta ao "⋯" da conversa

### Requirement: Depois da exclusão

Excluída a conversa, o foco SHALL ir para a conversa vizinha e um aviso discreto (`aria-live`) MUST
confirmar. Se a conversa excluída era a aberta (`?c=`), o app MUST voltar ao chat vazio com a mesma
data de referência, sem deixar a conversa excluída no histórico do navegador. Uma resposta ainda em
andamento na conversa SHALL dar uma mensagem própria no diálogo.

#### Scenario: Excluir a conversa aberta

- **WHEN** o usuário está em `/pt-BR/chat/?c=<id>&ref=2008-05` e exclui essa conversa pelo painel de histórico
- **THEN** o app vai para `/pt-BR/chat/?ref=2008-05`, com o chat vazio

#### Scenario: Resposta em andamento

- **WHEN** a exclusão responde 409 `stream_busy`
- **THEN** o diálogo continua aberto, explica que a resposta ainda está sendo gerada e a conversa fica na lista
