## ADDED Requirements

### Requirement: Área de trabalho em duas colunas

A página do chat MUST mostrar, a partir de 768 px, no máximo duas colunas: o histórico e a conversa
ou, com uma citação aberta, a conversa e o painel de citação, separados por um separador
redimensionável com nome acessível que responde ao teclado. Sem citação aberta, SHALL NOT haver
painel de citação. A conversa SHALL NOT ser desmontada quando a janela cruza 768 px nem quando a
citação abre ou fecha.

#### Scenario: Citação no lugar do histórico

- **WHEN** o usuário abre uma citação com o histórico aberto
- **THEN** o painel de citação entra à direita da conversa e o histórico vira o trilho até a citação
  fechar

### Requirement: Histórico recolhível

No desktop, o histórico do chat MUST poder ser recolhido por um botão, com a escolha lembrada no
navegador (storage bloqueado vale como aberto). Recolhido, ou com a citação aberta, ele SHALL virar
um trilho com o botão "Mostrar o histórico" e o atalho de nova conversa.

#### Scenario: Histórico recolhido lembrado

- **WHEN** o usuário recolhe o histórico e recarrega a página
- **THEN** o histórico continua recolhido, com "Mostrar o histórico" e "Nova conversa" à vista

## MODIFIED Requirements

### Requirement: App shell das páginas do app

As páginas do app (chat, history, settings, provision e compare) MUST ficar num layout comum com um
cabeçalho (marca, navegação, paleta, idioma, tema e conta) e um `<main>` alvo do skip link. O aviso
"Apoio à consulta; não constitui parecer" MUST ficar discreto, sem barra fixa: no chat, abaixo do
composer, sempre à vista; nas outras páginas, no fim do conteúdo. A troca de idioma SHALL manter a
página, a query e a âncora, e o layout SHALL continuar montado entre essas páginas.

#### Scenario: Aviso sempre visível

- **WHEN** o usuário rola uma conversa longa no chat
- **THEN** o aviso "Apoio à consulta; não constitui parecer" continua na tela, abaixo do composer

#### Scenario: Aviso nas outras páginas

- **WHEN** o usuário rola até o fim de `/pt-BR/settings/`
- **THEN** o aviso aparece numa linha pequena no fim do conteúdo

#### Scenario: Idioma sem perder a página

- **WHEN** o usuário em `/pt-BR/settings/` abre o menu de idioma e escolhe English
- **THEN** o navegador vai para `/en/settings/`

### Requirement: Área de trabalho no celular

Abaixo de 768 px, a página do chat MUST deixar só a conversa na tela, com o histórico num Sheet
aberto por um botão visível e a citação num Drawer aberto pelo chip ou pela fonte. O HTML estático
SHALL NOT mostrar os painéis laterais no celular antes da hidratação.

#### Scenario: Citação no celular

- **WHEN** o usuário num viewport de 375 px toca no chip 1 de uma resposta
- **THEN** a citação abre num Drawer, que fecha com Esc ou arrastando para baixo

## REMOVED Requirements

### Requirement: Área de trabalho em três painéis

**Reason**: três colunas sempre, com o painel de citação vazio ocupando um terço da largura,
poluíam a tela; a área de trabalho passa a ter duas colunas no máximo.

**Migration**: substituída por "Área de trabalho em duas colunas"; o separador da citação continua
com o nome "Redimensionar a citação", e o do histórico deu lugar ao botão de recolher.
