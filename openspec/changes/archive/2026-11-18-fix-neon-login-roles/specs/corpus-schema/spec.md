## MODIFIED Requirements

### Requirement: Credenciais fora do repositório

Os roles de login MUST ser criados por SQL pelo owner do banco, fora do `neon_superuser`, com senha
gerada pelo script, e as URLs SHALL ir direto para os GitHub Environments e para a `DATABASE_URL`
do projeto Vercel, sem passar por arquivo, terminal ou repositório.

#### Scenario: Projeto novo

- **WHEN** o mantenedor roda `scripts/neon-roles.ts --env production` num projeto sem os roles
- **THEN** o script cria `teko_app` e `teko_watch` por SQL e grava `NEON_PROD_APP_URL` (environment `maintenance`), `NEON_PROD_WATCH_URL` (environment `corpus-watch`) e a `DATABASE_URL` do `tekoia`, sem imprimir nenhum valor

#### Scenario: Role criado pela API do Neon

- **WHEN** um role de login é membro do `neon_superuser` ou o owner não tem `ADMIN` sobre ele
- **THEN** o script revoga o que o owner concedeu, apaga o role pela API do Neon, o recria por SQL e regrava todos os destinos da URL

#### Scenario: Segredo faltando

- **WHEN** o role foi criado por SQL e falta um dos segredos dele
- **THEN** o script troca a senha e regrava todos os destinos do role
