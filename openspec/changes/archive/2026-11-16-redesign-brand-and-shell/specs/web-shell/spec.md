## MODIFIED Requirements

### Requirement: Tokens de cor com contraste verificado

Toda cor do `apps/web` MUST vir de um token OKLCH de `globals.css` tirado da paleta da logo, com
o par claro e escuro em `light-dark()`: a primária petróleo `oklch(0.42 0.074 214.6)`, os tokens de
marca, de folha e de domínio. Um teste unitário SHALL exigir, nos dois temas, contraste ≥ 4,5:1 nos
pares de texto e ≥ 3:1 nos de componente de UI, de foco e da folha como forma.

#### Scenario: Token sem contraste

- **WHEN** alguém muda `--muted-foreground` do tema escuro para um tom que fica abaixo de 4,5:1
  sobre `--popover`
- **THEN** o `test:unit` do web falha apontando o par e o tema

#### Scenario: Token de domínio no painel lateral

- **WHEN** `--validity-superseded` aparece como texto sobre `--surface` no tema claro
- **THEN** o teste confere o contraste desse par, além do par sobre `--background`

#### Scenario: Texto sobre a marca

- **WHEN** alguém escurece `--brand-foreground` do tema claro até ficar abaixo de 4,5:1 sobre
  `--brand-deep`
- **THEN** o `test:unit` do web falha apontando o par

### Requirement: App shell das páginas do app

As páginas do app (chat, history, settings, provision e compare) MUST ficar num layout comum com um
cabeçalho (marca, navegação principal, paleta de comandos, menu de idioma, tema e a conta), um
`<main>` alvo do skip link e o aviso fixo "Apoio à consulta; não constitui parecer", visível sem
rolar. A troca de idioma SHALL manter a página atual, a query e a âncora. O layout SHALL continuar
montado na navegação entre essas páginas.

#### Scenario: Aviso sempre visível

- **WHEN** o usuário rola uma página longa do app
- **THEN** o aviso "Apoio à consulta; não constitui parecer" continua na tela

#### Scenario: Idioma sem perder a página

- **WHEN** o usuário em `/pt-BR/settings/` abre o menu de idioma e escolhe English
- **THEN** o navegador vai para `/en/settings/`

## ADDED Requirements

### Requirement: Identidade visual da logo

O web MUST usar a logo (`docs/assets/logo.svg`) como componente SVG inline (`TekoLogo`, selo e ícone
compacto, gradientes em `<defs>` e sem `<style>`) e o wordmark "Tekó" em serif nos cabeçalhos e no
rodapé. Todo documento do export SHALL declarar o favicon em SVG e o ícone da Apple gerados da logo,
o `theme-color` dos dois temas igual ao `--background` e, nas páginas de locale, a imagem do Open
Graph com a logo. Nenhum texto visível SHALL dizer que o produto está em construção.

#### Scenario: Ícones e Open Graph

- **WHEN** alguém abre `/pt-BR/`
- **THEN** o `<head>` tem `link rel="icon"` para `/icon.svg`, `link rel="apple-touch-icon"` para
  `/apple-icon.png`, dois `theme-color` e `og:image` terminando em `/og.png`, e os três arquivos
  respondem 200

#### Scenario: Sem "em construção"

- **WHEN** alguém procura "em construção" ou "under construction" nos catálogos
- **THEN** não encontra nenhuma mensagem

### Requirement: App só com a sessão pronta

As páginas do grupo `(app)` MUST mostrar o app (cabeçalho, conteúdo e rodapé) só depois de saber a
sessão pelo `GET /api/v1/me`. Enquanto ele carrega, e no HTML estático antes da hidratação, SHALL
aparecer só a tela da marca com o estado anunciado; sem sessão, a mesma tela até a entrada (com o
retorno à página e à query atuais), sem pintar o app; com o `/me` indisponível, a tela com uma ação
de tentar de novo.

#### Scenario: Abrir o Tekó sem sessão

- **WHEN** um visitante sem cookie de sessão clica em "Abrir o Tekó"
- **THEN** o navegador vai para `/pt-BR/sign-in/?callbackURL=%2Fpt-BR%2Fchat%2F` sem que a
  navegação principal do app chegue ao documento

#### Scenario: HTML estático do chat

- **WHEN** `/pt-BR/chat/` abre com o JavaScript desligado
- **THEN** a página mostra "Carregando o Tekó…" com a logo, sem a navegação do app nem o composer

#### Scenario: Sessão indisponível

- **WHEN** o `GET /api/v1/me` falha por rede ou 5xx
- **THEN** a tela da marca mostra o erro e "Tentar de novo", que consulta o `/me` outra vez
