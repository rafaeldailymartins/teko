# Spec Delta

## ADDED Requirements

### Requirement: Tokens de cor com contraste verificado

Toda cor do `apps/web` MUST vir de um token OKLCH de `globals.css` com o par claro e escuro em
`light-dark()`, inclusive a primária petróleo `oklch(0.50 0.09 205)` e os tokens de domínio
(`--validity-*`, `--coverage-out`, `--degraded`). Um teste unitário SHALL exigir, nos dois temas,
contraste ≥ 4,5:1 nos pares de texto e ≥ 3:1 nos de componente de UI e de foco.

#### Scenario: Token sem contraste

- **WHEN** alguém muda `--muted-foreground` do tema escuro para um tom que fica abaixo de 4,5:1
  sobre `--popover`
- **THEN** o `test:unit` do web falha apontando o par e o tema

#### Scenario: Token de domínio no painel lateral

- **WHEN** `--validity-superseded` aparece como texto sobre `--surface` no tema claro
- **THEN** o teste confere o contraste desse par, além do par sobre `--background`

### Requirement: Acento reservado para data e vigência

O acento âmbar MUST ficar reservado para a data de referência e a vigência. O destaque de itens de
menu e da paleta de comandos SHALL usar `--muted`, nunca `--accent`.

#### Scenario: Item destacado no menu de tema

- **WHEN** o usuário passa pelo item "Escuro" do seletor de tema com as setas
- **THEN** o item fica com o fundo `--muted`, sem âmbar

### Requirement: Tema claro, escuro ou do sistema

O cabeçalho MUST oferecer um seletor de tema com claro, escuro e igual ao sistema. A escolha SHALL
ser gravada em `localStorage['teko-theme']` e aplicada em `data-theme` no `<html>`; "igual ao
sistema" SHALL apagar a chave e o atributo, e o CSS volta a seguir `prefers-color-scheme`. O tema
salvo MUST valer antes da primeira pintura pelo script inline já existente, sem mudar o texto dele
(o hash vai para o CSP). Storage bloqueado SHALL NOT impedir a troca na página atual.

#### Scenario: Escolha persistida

- **WHEN** o usuário escolhe "Escuro" e recarrega a página
- **THEN** a página pinta já no tema escuro, sem piscar o claro

#### Scenario: Voltar ao sistema

- **WHEN** o usuário com "Claro" salvo escolhe "Igual ao sistema"
- **THEN** `teko-theme` some do storage, `data-theme` some do `<html>` e o tema segue o sistema

### Requirement: App shell das páginas do app

As páginas do app (chat, history, settings, provision e compare) MUST ficar num layout comum com um
cabeçalho (marca, navegação principal, paleta de comandos, idioma e tema), um `<main>` alvo do skip
link e o aviso fixo "Apoio à consulta; não constitui parecer", visível sem rolar. A troca de idioma
SHALL manter a página atual e SHALL NOT levar a query. O layout SHALL continuar montado na navegação
entre essas páginas.

#### Scenario: Aviso sempre visível

- **WHEN** o usuário rola uma página longa do app
- **THEN** o aviso "Apoio à consulta; não constitui parecer" continua na tela

#### Scenario: Idioma sem perder a página

- **WHEN** o usuário em `/pt-BR/settings/` escolhe English
- **THEN** o navegador vai para `/en/settings/`

### Requirement: Paleta de comandos

`Ctrl+K` (ou `⌘+K` no macOS) MUST abrir e fechar a paleta de comandos em qualquer página do app, e o
cabeçalho MUST ter um botão visível que a abre. A paleta SHALL filtrar pelo texto digitado, navegar
por setas, executar com Enter, fechar com Esc devolvendo o foco e oferecer a navegação entre as
páginas e a troca de tema. Atalhos com Alt ou Shift SHALL NOT abri-la.

#### Scenario: Navegar pela paleta

- **WHEN** o usuário tecla `Ctrl+K`, digita "hist" e tecla Enter
- **THEN** a paleta fecha e o app vai para a página de histórico do locale atual

### Requirement: Área de trabalho em três painéis

A página do chat MUST mostrar, a partir de 768 px, três painéis redimensionáveis (histórico,
conversa e citação) cujos separadores SHALL ter nome acessível e responder ao teclado (setas,
Home/End e Enter para recolher). A conversa SHALL NOT ser desmontada quando a janela cruza 768 px.

#### Scenario: Redimensionar pelo teclado

- **WHEN** o usuário foca o separador do histórico e tecla seta para a direita
- **THEN** o painel de histórico cresce e o separador anuncia o novo valor

### Requirement: Área de trabalho no celular

Abaixo de 768 px, a página do chat MUST deixar só a conversa na tela, com o histórico num Sheet e a
citação num Drawer abertos por botões visíveis. O HTML estático SHALL NOT mostrar os painéis
laterais no celular antes da hidratação.

#### Scenario: Citação no celular

- **WHEN** o usuário num viewport de 375 px toca em "Citação"
- **THEN** a citação abre num Drawer, que fecha com Esc ou arrastando para baixo

### Requirement: Páginas-esqueleto e landing estáticas

Cada rota de `src/app/[locale]/` MUST só reexportar de `src/components`. As páginas chat, history,
settings, provision, compare, coverage, about, privacy, terms e sign-in SHALL existir nos dois
locales com título, descrição, canonical e hreflang, e um estado vazio com texto do catálogo. A
landing SHALL ter hero com demonstração estática, "Como funciona", corpus coberto, garantias e
FAQ, e SHALL NOT chamar a API. Todo texto visível MUST vir do next-intl, com as mesmas chaves em
`en` e `pt-BR`.

#### Scenario: Export estático das páginas

- **WHEN** o build do web roda
- **THEN** `out/` tem `pt-BR/<página>/index.html` e `en/<página>/index.html` para as dez páginas,
  sem route handlers nem functions

#### Scenario: Landing sem JavaScript

- **WHEN** a landing abre com o JavaScript desligado
- **THEN** o hero, as seções e as respostas do FAQ (em `<details>`) continuam legíveis e operáveis

### Requirement: Componentes sem estilo injetado em runtime

Os componentes do design system MUST vir do registry Base UI do shadcn, copiados para
`src/components/ui` sem o CLI no lockfile, e SHALL NOT injetar `<style>` em runtime: a configuração
do Base UI desliga a injeção e as regras que ele injetaria ficam em `globals.css`. Os providers de
cliente MUST ficar em `src/components/providers.tsx`, montado no layout de locale.

#### Scenario: Scroll area sem style inline

- **WHEN** o painel de histórico com scroll area abre num Sheet já no cliente
- **THEN** nenhum `<style>` é inserido no documento, e a barra nativa continua escondida pela regra
  de `globals.css`
