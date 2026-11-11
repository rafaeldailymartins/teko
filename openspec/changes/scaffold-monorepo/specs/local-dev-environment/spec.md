# Spec Delta

## Purpose

Oferece uma stack de desenvolvimento local reproduzível, isolada na máquina do desenvolvedor, que
imita o proxy assinado da Netlify para que a API local seja exercitada como em produção.

## ADDED Requirements

### Requirement: Segredos locais gerados sem sobrescrever

O comando `pnpm dev:secrets` MUST gerar os segredos locais ausentes em `apps/api/.env` e
`infra/local/.env`, MUST NOT sobrescrever um segredo existente e MUST NOT imprimir valores.

#### Scenario: Primeira execução

- **WHEN** o desenvolvedor roda `pnpm dev:secrets` sem nenhum `.env`
- **THEN** os dois arquivos são criados com segredos aleatórios e o terminal lista só os nomes das chaves

#### Scenario: Execução repetida

- **WHEN** o comando roda de novo com os arquivos completos e o token de dev ainda válido
- **THEN** nenhum arquivo muda e o terminal informa que não há chaves novas

#### Scenario: Arquivo não ignorado pelo git

- **WHEN** um dos arquivos de destino não está coberto pelo `.gitignore`
- **THEN** o comando termina com código 1 sem escrever nada

### Requirement: Token do proxy de dev renovável

O token `DEV_STATIC_JWS` MUST ser um JWS HS256 com os claims do proxy da Netlify (`iss=netlify`,
`deploy_context=dev`, `site_url`, `exp` de 7 dias) e SHALL ser assinado de novo quando faltar,
expirar em menos de 24 h ou não conferir com o segredo atual.

#### Scenario: Token expirando

- **WHEN** o desenvolvedor roda `pnpm dev:secrets` e o token expira em menos de 24 h
- **THEN** só a linha `DEV_STATIC_JWS` é substituída e os segredos continuam iguais

### Requirement: Proxy assinado de dev

O proxy local MUST escutar só em `127.0.0.1:8787`, encaminhar apenas `/api/*` para a API local e
SHALL sobrescrever `x-nf-sign`, `x-nf-client-connection-ip` e `x-nf-request-id` enviados pelo
cliente.

#### Scenario: Chamada pelo proxy

- **WHEN** o navegador chama `http://localhost:8787/api/v1/...`
- **THEN** a API recebe um `x-nf-sign` válido para `deploy_context=dev`, o IP do cliente e um request id

#### Scenario: Header forjado pelo cliente

- **WHEN** o cliente envia `x-nf-sign: forjado`
- **THEN** a API recebe o token de dev, nunca o valor do cliente

#### Scenario: Corpo acima do limite

- **WHEN** o cliente envia um corpo maior que 32 KB para `/api/*`
- **THEN** o proxy responde 413 sem chamar a API

#### Scenario: Rota fora de /api

- **WHEN** o cliente chama `http://localhost:8787/`
- **THEN** o proxy responde 404

### Requirement: Banco local com paridade de versão

O banco local MUST ser PostgreSQL 18 com pgvector 0.8.6, com dados num volume persistente e porta
publicada só em `127.0.0.1`.

#### Scenario: Extensão vetorial disponível

- **WHEN** a stack sobe com `docker compose -f infra/local/compose.yaml up -d --wait`
- **THEN** o healthcheck do Postgres fica saudável e `CREATE EXTENSION vector` instala a versão 0.8.6

### Requirement: Langfuse local opcional

O profile `langfuse` MUST subir um Langfuse self-hosted já com organização, projeto, chaves de API
e usuário criados a partir de `infra/local/.env`, sem publicar portas fora de `127.0.0.1`.

#### Scenario: Profile ativado

- **WHEN** o desenvolvedor sobe a stack com `--profile langfuse`
- **THEN** `http://localhost:3100/api/public/health` responde 200 e as chaves de `apps/api/.env` autenticam na API pública
