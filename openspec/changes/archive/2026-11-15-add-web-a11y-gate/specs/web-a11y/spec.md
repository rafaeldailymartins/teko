# Spec Delta

## ADDED Requirements

### Requirement: axe zero nas rotas principais

O e2e do web MUST rodar o axe com as regras WCAG 2.2 AA (`wcag2a` a `wcag22aa`) nas rotas
principais, inclusive o chat com o painel de citação aberto e o banner de consentimento, em en e
pt-BR, nos temas claro e escuro, nos projetos desktop e mobile. Qualquer violação MUST reprovar o
job `e2e`; as rotas do grupo `(app)` SHALL entrar com a sessão de teste da stack de CI.

#### Scenario: Rotas cobertas

- **WHEN** o job `e2e` roda o `a11y.spec.ts`
- **THEN** o axe analisa landing, entrada, chat vazio, histórico, dispositivo, comparação,
  configurações, privacidade, termos, sobre, cobertura e 404 em cada idioma, tema e projeto

#### Scenario: Página sem violação

- **WHEN** o job `e2e` abre `/pt-BR/settings/` no tema escuro, no projeto mobile, com a sessão de
  teste
- **THEN** o axe não devolve nenhuma violação e o teste passa

#### Scenario: Violação reprova

- **WHEN** um botão só com ícone perde o nome acessível
- **THEN** o teste da rota falha com a regra (`button-name`), o impacto e o HTML do elemento, e as
  violações completas vão para um arquivo no diretório do teste

#### Scenario: Chat com resposta

- **WHEN** a pessoa pergunta no chat com a data 05/2008 e abre o chip da primeira citação
- **THEN** o axe roda com a resposta na tela e de novo com o painel de citação aberto (o Drawer no
  celular), sem violação nas duas vezes

### Requirement: Exceção só por seletor

O gate de acessibilidade MUST NOT desligar uma regra do axe para a página toda. Uma exceção SHALL
excluir só o elemento, por seletor CSS, com o motivo escrito ao lado no `a11y.spec.ts`.

#### Scenario: Exceção documentada

- **WHEN** um componente de terceiro tem um falso positivo do axe
- **THEN** a exceção entra na lista `EXCEPTIONS` com o seletor do componente e o motivo, e as demais
  regras continuam valendo no resto da página

### Requirement: Rótulo visível no nome acessível

Um controle com texto visível MUST ter esse texto no começo do nome acessível (WCAG 2.5.3). O botão
da conta, que mostra as iniciais, SHALL ter como nome as iniciais seguidas de "Conta de {nome}".

#### Scenario: Botão da conta

- **WHEN** a sessão é de Ana Souza
- **THEN** o botão mostra "AS" e o nome acessível é "AS Conta de Ana Souza"

### Requirement: Título da página no chat

A página do chat MUST ter um `h1` com ou sem conversa: o título do estado vazio sem conversa e o
título da página, visualmente oculto, com a conversa na tela.

#### Scenario: Conversa na tela

- **WHEN** a primeira resposta chega
- **THEN** a página continua com um `h1` ("Chat")
