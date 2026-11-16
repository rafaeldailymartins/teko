# web-auth Specification

## Purpose

Define as telas de autenticação e conta do web do Tekó: entrada com OAuth, passkey e e-mail e
senha, com retorno seguro, sessão no app shell, onboarding antes do composer e configurações com os direitos do
titular e as preferências da interface.

## Requirements

### Requirement: Entrada com os métodos do ambiente e retorno seguro

A página de entrada MUST oferecer só os métodos que `GET /api/v1/auth/providers` devolve, entre
GitHub e Google (com os símbolos das marcas), passkey e e-mail e senha. O retorno depois do login
(`?callbackURL=`) MUST ser só um caminho relativo de uma página da própria origem; URL absoluta,
`//host`, barra invertida, caractere de controle, separador codificado no caminho, `/api/` e a
própria entrada SHALL ser trocados pelo chat do idioma.

#### Scenario: Retorno à página de origem

- **WHEN** num ambiente com os OAuth apps, quem está em
  `/pt-BR/sign-in/?callbackURL=%2Fpt-BR%2Fhistory%2F` escolhe o GitHub
- **THEN** a web chama `POST /api/auth/sign-in/social` com `provider: github`, `callbackURL:
  /pt-BR/history/` e o retorno de erro na própria entrada, e navega para a URL que a API devolve

#### Scenario: Retorno para outra origem

- **WHEN** a entrada recebe `?callbackURL=https://evil.example/`
- **THEN** o login segue com `callbackURL: /pt-BR/chat/`

#### Scenario: Ambiente sem OAuth apps

- **WHEN** `GET /api/v1/auth/providers` devolve só `passkey` e `email`, como localmente e na stack
  de CI
- **THEN** a entrada mostra a passkey e o formulário de e-mail e senha, sem os botões do GitHub e do
  Google

### Requirement: Erros da entrada e aviso de região

Um `?error=` na página de entrada MUST virar mensagem (cancelado, conta bloqueada, e-mail que usa
outro método de entrada, e-mail ausente ou genérica), e `region_restricted` SHALL virar a página de
aviso de indisponibilidade na região, com o caminho para a página inicial e para as configurações.
Qualquer consulta ou mutação das páginas do app recusada com `region_restricted` MUST levar a essa
página.

#### Scenario: Login cancelado no provedor

- **WHEN** o Better Auth volta para a entrada com `?error=access_denied`
- **THEN** a página mostra que o login foi cancelado e mantém as formas de entrar

#### Scenario: E-mail de outro método

- **WHEN** o Better Auth volta para a entrada com `?error=account_not_linked`
- **THEN** a página diz que este e-mail usa outro método de entrada e pede o método da primeira vez

#### Scenario: Região restrita

- **WHEN** a entrada recebe `?error=region_restricted`
- **THEN** a página mostra o aviso de indisponibilidade na região, sem as formas de entrar

### Requirement: Sessão no app shell

O cabeçalho e a paleta do app MUST refletir a sessão do `GET /api/v1/me`: sem sessão, "Entrar" com o
retorno à página atual; com sessão, o menu da conta com nome, e-mail, configurações e sair, com as
iniciais no lugar da foto do provedor. As páginas do grupo `(app)` sem sessão SHALL mandar para a
entrada com o retorno à página e à query atuais; a guarda é só de experiência, e a API continua
recusando sem sessão.

#### Scenario: Chat sem sessão

- **WHEN** alguém sem cookie de sessão abre `/pt-BR/chat/?ref=2024-03`
- **THEN** o navegador vai para `/pt-BR/sign-in/?callbackURL=%2Fpt-BR%2Fchat%2F%3Fref%3D2024-03`

#### Scenario: Sair

- **WHEN** o usuário escolhe "Sair" no menu da conta
- **THEN** a web chama `POST /api/auth/sign-out` e recarrega na página inicial do idioma

### Requirement: Onboarding antes do composer

Com o onboarding pendente, as páginas do app MUST abrir um diálogo que não fecha por `Esc` nem por
clique fora, com o aviso de treino do provedor de IA gratuito, a declaração de 18+, o aceite da
versão vigente dos Termos (com links para `/terms` e `/privacy`) e o país de residência. As saídas
SHALL ser concluir (`POST /api/v1/me/onboarding`) ou sair da conta, e o composer MUST ficar
bloqueado sem sessão, enquanto ela carrega e com o onboarding pendente.

#### Scenario: Primeiro uso

- **WHEN** um usuário sem onboarding abre o chat, marca 18+ e os Termos, busca "portu" e escolhe
  `PT`
- **THEN** a web envia `isAdult: true`, a versão vigente e `PT`, e o diálogo fecha com o `/me`
  atualizado

#### Scenario: Esc no diálogo

- **WHEN** o diálogo do onboarding está aberto e o usuário tecla `Esc`
- **THEN** o diálogo continua aberto

### Requirement: Novo aceite dos Termos

Quando a versão vigente dos Termos muda, o diálogo do onboarding MUST pedir o aceite da versão nova,
com o título de Termos alterados. Nas configurações ele SHALL NOT abrir sozinho: exportar e excluir
a conta não dependem do aceite.

#### Scenario: Termos novos

- **WHEN** o `/me` traz `acceptedTermsVersion` diferente de `currentTermsVersion`
- **THEN** o diálogo abre com o título de Termos alterados e pede o aceite da versão vigente

#### Scenario: Configurações com aceite pendente

- **WHEN** um usuário com o onboarding pendente abre as configurações
- **THEN** a página abre sem o diálogo e mostra um aviso para concluir o cadastro

### Requirement: Configurações da conta

A página de configurações MUST mostrar a conta com o método de entrada (GitHub, Google ou e-mail e
senha, por `GET /api/auth/list-accounts`), a cota do dia (`GET /api/v1/me/quota`) com o que resta,
as passkeys (cadastrar e remover) e a exportação dos dados, que SHALL baixar o JSON de
`GET /api/v1/me/export` como arquivo. Cadastrar passkey com sessão antiga MUST pedir para entrar de
novo.

#### Scenario: Exportar

- **WHEN** o usuário com sessão escolhe "Exportar meus dados"
- **THEN** o navegador baixa `teko-meus-dados.json` com o perfil da conta

#### Scenario: Passkey com sessão antiga

- **WHEN** o cadastro de passkey recebe 401 ou 403 nas opções de registro
- **THEN** a tela pede para sair e entrar de novo, sem abrir a cerimônia do navegador

#### Scenario: Método de entrada

- **WHEN** a conta da sessão foi criada por e-mail e senha
- **THEN** a seção da conta mostra "E-mail e senha" como método de entrada

### Requirement: Exclusão da conta

A exclusão MUST exigir a palavra de confirmação digitada, chamar `DELETE /api/v1/me` e recarregar na
página inicial do idioma.

#### Scenario: Excluir sem confirmar

- **WHEN** o diálogo de exclusão está aberto e a palavra de confirmação não foi digitada
- **THEN** o botão de excluir fica desabilitado e nenhuma chamada sai

### Requirement: Preferências de tema, idioma e densidade

As configurações MUST trocar o tema, o idioma (mantendo a página) e a densidade. A densidade
compacta SHALL ficar em `data-density` no `<html>`, guardada em `localStorage` e aplicada antes da
primeira pintura pelo mesmo script do tema.

#### Scenario: Densidade compacta

- **WHEN** o usuário escolhe a densidade compacta e recarrega a página
- **THEN** o `<html>` sai com `data-density="compact"` antes da primeira pintura

### Requirement: Layout e carregamento da entrada

No desktop, a entrada MUST ter duas colunas, o painel da marca ao lado do formulário; no celular,
só o formulário. Enquanto a lista de métodos carrega, a página SHALL mostrar um esqueleto com a
forma do formulário, e, se a lista falhar, SHALL oferecer a passkey e o e-mail.

#### Scenario: Métodos carregando

- **WHEN** a resposta de `GET /api/v1/auth/providers` ainda não chegou
- **THEN** a entrada mostra o esqueleto do formulário, anunciado como carregando, e nenhum botão

#### Scenario: Duas colunas no desktop

- **WHEN** alguém abre a entrada numa janela de desktop
- **THEN** o painel da marca fica à esquerda do formulário; no celular, ele não aparece

### Requirement: Formulário de e-mail e senha

Quando o ambiente oferece `email`, a entrada MUST ter as abas "Entrar" e "Criar conta", com campos
rotulados (nome só no cadastro), o botão de mostrar a senha e, no cadastro, a dica e o medidor do
mínimo de 12 caracteres. Os campos SHALL ser validados pelos schemas de `@teko/shared/contracts`
antes de qualquer chamada, com o erro ligado ao campo.

#### Scenario: Senha curta no cadastro

- **WHEN** alguém tenta criar conta com uma senha de 5 caracteres
- **THEN** o campo mostra que a senha precisa de pelo menos 12 caracteres e nenhuma chamada sai

#### Scenario: E-mail entre as abas

- **WHEN** alguém digita o e-mail na aba "Entrar" e troca para "Criar conta"
- **THEN** o e-mail continua no campo, e o nome e o medidor da senha aparecem

### Requirement: Envio, falhas e aviso do e-mail e senha

O envio do formulário de e-mail SHALL mostrar o estado de envio, e cada falha da API MUST virar uma
mensagem própria, sem revelar se o e-mail tem conta. A tela MUST avisar que não há confirmação de
e-mail nem recuperação de senha, com link para os Termos. No sucesso, a web relê o `/me` e segue
para o retorno saneado.

#### Scenario: E-mail que já tem conta

- **WHEN** o cadastro responde 200 e a entrada logo depois responde 401
- **THEN** a tela diz que não foi possível criar a conta com este e-mail e sugere entrar pelo método
  de sempre

#### Scenario: Entrada com retorno

- **WHEN** quem está em `/pt-BR/sign-in/?callbackURL=%2Fpt-BR%2Fhistory%2F` entra com e-mail e
  senha certos
- **THEN** a web chama `POST /api/auth/sign-in/email`, relê o `/me` e vai para `/pt-BR/history/`

### Requirement: Passos do onboarding

O diálogo do onboarding SHALL mostrar os passos numerados (18+, Termos e país) com o progresso, e o
país MUST ser escolhido numa lista com busca, sem acento nem caixa, por nome ou código. O botão de
concluir SHALL ficar desabilitado até os passos estarem completos.

#### Scenario: Passos incompletos

- **WHEN** o diálogo está aberto e o aceite dos Termos não foi marcado
- **THEN** o botão de concluir fica desabilitado e o progresso mostra as confirmações que faltam

#### Scenario: Busca de país sem acento

- **WHEN** o usuário abre o país e busca "sao tome"
- **THEN** a lista mostra São Tomé e Príncipe

### Requirement: Navegação e zona de perigo nas configurações

As configurações SHALL ter uma navegação para as seções, lateral no desktop e em faixa no celular,
marcando a seção em vista, e a exclusão da conta MUST ficar numa zona de perigo separada da
exportação.

#### Scenario: Seção em vista

- **WHEN** o usuário abre as configurações com sessão
- **THEN** a navegação lista conta, cota, passkeys, preferências, dados e zona de perigo, com a conta
  marcada como a seção em vista

#### Scenario: Exclusão separada

- **WHEN** o usuário procura onde excluir a conta
- **THEN** o botão "Excluir conta" está na zona de perigo, não na seção de dados
