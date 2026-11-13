# local-dev-environment Specification

## Purpose

Oferece uma stack de desenvolvimento local reproduzível, isolada na máquina do desenvolvedor, que
serve a web e a API numa origem só (o `next dev` repassa `/api/*` à API), como em produção (ADR 0029).

## Requirements

### Requirement: Segredos locais gerados sem sobrescrever

O comando `pnpm dev:secrets` MUST gerar os segredos locais ausentes em `apps/api/.env` e
`infra/local/.env`, MUST NOT sobrescrever um segredo existente e MUST NOT imprimir valores.

#### Scenario: Primeira execução

- **WHEN** o desenvolvedor roda `pnpm dev:secrets` sem nenhum `.env`
- **THEN** os dois arquivos são criados com segredos aleatórios e o terminal lista só os nomes das chaves

#### Scenario: Execução repetida

- **WHEN** o comando roda de novo com os arquivos completos
- **THEN** nenhum arquivo muda e o terminal informa que não há chaves novas

#### Scenario: Arquivo não ignorado pelo git

- **WHEN** um dos arquivos de destino não está coberto pelo `.gitignore`
- **THEN** o comando termina com código 1 sem escrever nada

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

### Requirement: Web e API na mesma origem em dev

O `next dev` (`127.0.0.1:3000`) MUST repassar `/api/*` para a API local (`pnpm dev`, porta 4000),
para o navegador ver uma origem só, como em produção, e o `WEB_ORIGIN` local SHALL ser a origem do
`next dev`.

#### Scenario: Chamada da web à API

- **WHEN** o navegador chama `http://localhost:3000/api/v1/...`
- **THEN** a requisição chega à API local sem proxy assinado nem CORS
