## ADDED Requirements

### Requirement: E-mail e senha no cliente

A camada de dados MUST expor o cadastro e a entrada por e-mail pelo `apiClient`, sem o cliente do
Better Auth, e o cadastro SHALL entrar logo depois. As falhas que a tela explica MUST chegar como
`EmailAuthError` (credenciais inválidas, conta indisponível no cadastro, senha curta ou longa, e-mail
ou nome inválido, campo recusado e limite de tentativas); rede, 403 e 5xx seguem como `ApiError`.

#### Scenario: Cadastro de um e-mail que já tem conta

- **WHEN** o cadastro responde 200 e a entrada logo depois responde 401
- **THEN** `signUpWithEmail` falha com `EmailAuthError` `accountUnavailable`

#### Scenario: Senha curta

- **WHEN** o cadastro responde 400 com `PASSWORD_TOO_SHORT`
- **THEN** `signUpWithEmail` falha com `EmailAuthError` `passwordTooShort` sem tentar entrar

### Requirement: Métodos de entrada no cliente

Os métodos de entrada ativos MUST vir de `GET /v1/auth/providers` pelo hook `useAuthProviders`, e as
mutações de e-mail e senha SHALL reler o `/me` no sucesso.

#### Scenario: Entrada concluída

- **WHEN** `useEmailSignIn` termina com sucesso
- **THEN** a consulta do `/me` fica invalidada e é relida por quem a observa
