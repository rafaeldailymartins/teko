## REMOVED Requirements

### Requirement: Login sem e-mail

**Reason**: o mantenedor decidiu oferecer e-mail e senha em todos os ambientes, sem confirmação de
e-mail nem recuperação de senha (ADR 0036).

**Migration**: o requisito "Métodos de login" substitui este, com o mesmo OAuth, a mesma passkey e
a mesma telemetria desligada; os requisitos novos de e-mail e senha cobrem o resto.

## ADDED Requirements

### Requirement: Métodos de login

A API MUST autenticar por OAuth (GitHub e Google), por e-mail e senha e por passkey registrada
depois do primeiro login, pelo Better Auth em `/api/auth/*`. A telemetria do Better Auth MUST ficar
desligada, e as variáveis que a ligariam SHALL derrubar o boot.

#### Scenario: Início do OAuth do GitHub

- **WHEN** a web chama `POST /api/auth/sign-in/social` com `provider: github`
- **THEN** a resposta traz a URL de autorização do GitHub com o callback `<WEB_ORIGIN>/api/auth/callback/github`

### Requirement: Cadastro e entrada por e-mail

`POST /api/auth/sign-up/email` (nome, e-mail e senha) MUST criar a conta sem confirmar o e-mail e
SHALL NOT abrir sessão; `POST /api/auth/sign-in/email` MUST abrir a sessão por cookie. O e-mail
MUST ser gravado em minúsculas, e a senha só como o hash do Better Auth.

#### Scenario: Cadastro e entrada

- **WHEN** alguém se cadastra com nome, e-mail e uma senha de 12 caracteres ou mais e depois entra com eles
- **THEN** o cadastro responde sem sessão, a entrada grava o cookie e `GET /api/v1/me` pede o onboarding

### Requirement: Respostas que não revelam contas

O cadastro de um e-mail que já tem conta MUST responder o mesmo 200 de um cadastro novo, sem criar
nem alterar nada, e a entrada SHALL responder o mesmo 401 `INVALID_EMAIL_OR_PASSWORD` para e-mail
sem conta, conta sem senha e senha errada.

#### Scenario: E-mail que já tem conta

- **WHEN** alguém se cadastra com o e-mail de uma conta existente e outra senha
- **THEN** a resposta tem o mesmo formato de um cadastro novo, a senha antiga continua valendo e a nova não entra

#### Scenario: E-mail sem conta e senha errada

- **WHEN** alguém tenta entrar com um e-mail sem conta e, depois, com a senha errada de uma conta
- **THEN** as duas respostas são o mesmo 401, sem cookie de sessão

### Requirement: Sem rotas que dependem de e-mail

As rotas de confirmação de e-mail, troca de e-mail e recuperação de senha do Better Auth SHALL
responder 404: o Tekó não envia e-mails.

#### Scenario: Sem recuperação de senha

- **WHEN** chega `POST /api/auth/request-password-reset`
- **THEN** a API responde 404

### Requirement: Política do cadastro por e-mail

O cadastro MUST aceitar senha de 12 a 128 caracteres (unidades UTF-16, sem regra de composição e sem
aparar), nome aparado de 1 a 80 caracteres sem caractere de controle e e-mail de até 254, e SHALL
recusar com 400 foto, campo extra ou qualquer campo fora disso, com o código do campo
(`PASSWORD_TOO_SHORT`, `PASSWORD_TOO_LONG`, `INVALID_EMAIL`, `INVALID_NAME` ou
`VALIDATION_ERROR`). A política MUST vir de `@teko/shared/contracts`, a mesma do web.

#### Scenario: Senha curta

- **WHEN** alguém se cadastra com uma senha de 11 caracteres
- **THEN** a API responde 400 `PASSWORD_TOO_SHORT` e nada é gravado

### Requirement: Contas separadas por método

Uma conta de senha e uma conta OAuth com o mesmo e-mail MUST ficar separadas: o login OAuth com o
e-mail de uma conta de senha SHALL voltar para a entrada com `error=account_not_linked`, sem sessão e
sem vínculo, e o cadastro por senha com o e-mail de uma conta OAuth SHALL NOT criar credencial nela.
Nenhum provedor MUST ser confiável só pelo nome, e o vínculo manual SHALL exigir o mesmo e-mail.

#### Scenario: GitHub com o e-mail de uma conta de senha

- **WHEN** existe uma conta de senha com um e-mail e alguém entra pelo GitHub com o mesmo e-mail, confirmado pelo GitHub
- **THEN** o callback redireciona para a entrada com `error=account_not_linked`, e a conta de senha continua só com a credencial

#### Scenario: Senha com o e-mail de uma conta do GitHub

- **WHEN** existe uma conta do GitHub com um e-mail e alguém se cadastra por senha com o mesmo e-mail
- **THEN** o cadastro responde o 200 genérico, a entrada com essa senha dá 401 e a conta continua só com o GitHub

### Requirement: Limite de tentativas por e-mail

O rate limit do Better Auth MUST contar por IP e caminho, em banco, no máximo 5 entradas
(`/sign-in/email`) por minuto e 5 cadastros (`/sign-up/email`) a cada 10 minutos, e SHALL responder
429 acima disso. A guarda de `Origin` MUST valer para as duas rotas.

#### Scenario: Sexta entrada no minuto

- **WHEN** o mesmo IP tenta entrar por e-mail seis vezes no mesmo minuto
- **THEN** a sexta tentativa recebe 429, e outro IP continua sendo atendido

### Requirement: Métodos de entrada públicos

`GET /api/v1/auth/providers` MUST responder, sem sessão e sem segredo, os métodos de entrada ativos
no ambiente, na ordem `github`, `google`, `passkey`, `email`, só com os OAuth apps configurados, e
SHALL responder 503 `service_paused` sem o Better Auth.

#### Scenario: Ambiente sem OAuth apps

- **WHEN** a API sobe em development sem `GITHUB_CLIENT_ID` nem `GOOGLE_CLIENT_ID`
- **THEN** `GET /api/v1/auth/providers` responde `{ "methods": ["passkey", "email"] }`

## MODIFIED Requirements

### Requirement: Login obrigatório na API publicada

Em staging e produção com banco, o boot MUST exigir `BETTER_AUTH_SECRET` com ao menos 32
caracteres e os OAuth apps do GitHub e do Google; o id e o segredo de cada app SHALL vir juntos.
Development e ci MUST subir sem os OAuth apps, com passkey e e-mail e senha.

#### Scenario: Produção sem segredo

- **WHEN** a API sobe com `APP_ENV=production` e `DATABASE_URL`, sem `BETTER_AUTH_SECRET`
- **THEN** o boot falha citando `BETTER_AUTH_SECRET`

#### Scenario: Desenvolvimento sem OAuth apps

- **WHEN** a API sobe com `APP_ENV=development`, `DATABASE_URL` e `BETTER_AUTH_SECRET`, sem OAuth apps
- **THEN** o boot passa
