# Spec Delta

## ADDED Requirements

### Requirement: Entrada sem e-mail e com retorno seguro

A página de entrada MUST oferecer o login com GitHub, com Google e com passkey, e SHALL NOT oferecer
e-mail e senha. O retorno depois do login (`?callbackURL=`) MUST ser só um caminho relativo de uma
página da própria origem; URL absoluta, `//host`, barra invertida, caractere de controle, separador
codificado no caminho, `/api/` e a própria entrada SHALL ser trocados pelo chat do idioma.

#### Scenario: Retorno à página de origem

- **WHEN** quem está em `/pt-BR/sign-in/?callbackURL=%2Fpt-BR%2Fhistory%2F` escolhe o GitHub
- **THEN** a web chama `POST /api/auth/sign-in/social` com `provider: github`, `callbackURL:
  /pt-BR/history/` e o retorno de erro na própria entrada, e navega para a URL que a API devolve

#### Scenario: Retorno para outra origem

- **WHEN** a entrada recebe `?callbackURL=https://evil.example/`
- **THEN** o login segue com `callbackURL: /pt-BR/chat/`

### Requirement: Erros da entrada e aviso de região

Um `?error=` na página de entrada MUST virar mensagem (cancelado, conta bloqueada, conta não ligada,
e-mail ausente ou genérica), e `region_restricted` SHALL virar a página de aviso de
indisponibilidade na região. Qualquer consulta ou mutação das páginas do app recusada com
`region_restricted` MUST levar a essa página.

#### Scenario: Login cancelado no provedor

- **WHEN** o Better Auth volta para a entrada com `?error=access_denied`
- **THEN** a página mostra que o login foi cancelado e mantém os botões de login

#### Scenario: Região restrita

- **WHEN** a entrada recebe `?error=region_restricted`
- **THEN** a página mostra o aviso de indisponibilidade na região, sem os botões de login

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

- **WHEN** um usuário sem onboarding abre o chat, marca 18+ e os Termos e confirma o país `PT`
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

A página de configurações MUST mostrar a conta, a cota do dia (`GET /api/v1/me/quota`), as passkeys
(cadastrar e remover) e a exportação dos dados, que SHALL baixar o JSON de `GET /api/v1/me/export`
como arquivo. Cadastrar passkey com sessão antiga MUST pedir para entrar de novo.

#### Scenario: Exportar

- **WHEN** o usuário com sessão escolhe "Exportar meus dados"
- **THEN** o navegador baixa `teko-meus-dados.json` com o perfil da conta

#### Scenario: Passkey com sessão antiga

- **WHEN** o cadastro de passkey recebe 401 ou 403 nas opções de registro
- **THEN** a tela pede para sair e entrar de novo, sem abrir a cerimônia do navegador

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
