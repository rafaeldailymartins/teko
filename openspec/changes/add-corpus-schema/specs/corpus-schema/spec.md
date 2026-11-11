# Spec Delta

## Purpose

Define o modelo de dados do corpus com vigência, as migrações e o privilégio mínimo dos papéis que
acessam o banco.

## ADDED Requirements

### Requirement: Redações sem sobreposição

O banco MUST impedir que duas redações publicáveis (`auto` ou `approved`, com conhecimento atual)
do mesmo dispositivo e da mesma modalidade tenham vigências sobrepostas, e SHALL aceitar uma
anomalia `pending` sobreposta, que fica fora da busca de produção.

#### Scenario: Redação publicável sobreposta

- **WHEN** a ingestão grava uma redação `auto` do § 6º do art. 76 com vigência [2005-01-01, 2006-01-01), que cruza a do Dec. 6.026
- **THEN** o banco recusa a linha com violação de exclusão

#### Scenario: Anomalia pendente

- **WHEN** a mesma redação chega com `review_status` `pending`
- **THEN** o banco aceita a linha, e a busca de produção não a vê

### Requirement: Vigência com início

Toda redação e todo chunk MUST ter vigência não vazia e com limite inferior.

#### Scenario: Vigência sem início

- **WHEN** alguém grava uma redação com vigência `(,2000-01-01)`
- **THEN** o banco recusa a linha

### Requirement: Privilégio mínimo do runtime

O role `teko_app` MUST ter `statement_timeout` e `idle_in_transaction_session_timeout` de 5 s no
próprio role, ler o schema `corpus`, ler e escrever o schema `app`, inclusive em tabelas criadas
depois pelo owner, e SHALL receber `permission denied` em qualquer DDL.

#### Scenario: Timeout pelo role

- **WHEN** o `teko_app` conecta e roda `SHOW statement_timeout`
- **THEN** o valor é `5s`

#### Scenario: DDL negada

- **WHEN** o `teko_app` tenta `DROP TABLE corpus.chunks`
- **THEN** o Postgres responde `permission denied`

#### Scenario: Corpus só leitura

- **WHEN** o `teko_app` tenta atualizar `corpus.coverage`
- **THEN** o Postgres responde `permission denied`

### Requirement: Privilégio mínimo do source-watch

O role `teko_watch` MUST poder só ler `corpus.coverage` e atualizar `verified_at`, `gaps` e
`gap_reason`.

#### Scenario: Avanço diário do verified_at

- **WHEN** o `teko_watch` atualiza `verified_at` e `gaps` da cobertura do RCTE
- **THEN** a atualização é aceita

#### Scenario: Fora do permitido

- **WHEN** o `teko_watch` tenta mudar `covered` ou ler `corpus.chunks`
- **THEN** o Postgres responde `permission denied`

### Requirement: Escrita atômica do corpus

A escrita do corpus MUST acontecer numa transação que grava documentos, versões, dispositivos,
redações, chunks, fontes, cobertura e uma nova `corpus_versions`, e SHALL falhar inteira se algum
chunk publicável ficar sem versão de documento publicada.

#### Scenario: Semente da fixture

- **WHEN** o `cli seed-fixtures` grava a fixture única num banco migrado
- **THEN** o corpus fica com uma `corpus_versions`, a cobertura das seis famílias e todo chunk com embedding e fonte publicada

### Requirement: Busca léxica sem acentos

O `tsv` de cada chunk MUST ser gerado com `immutable_unaccent`, com o caminho de títulos em peso A
e o conteúdo em peso B.

#### Scenario: Pergunta sem acento

- **WHEN** a pergunta diz "secretario" e "nao"
- **THEN** ela casa com chunks que escrevem "Secretário" e "não"

### Requirement: Credenciais fora do repositório

Os roles de login MUST ser criados pela API do Neon, com senha gerada pelo Neon, e as URLs SHALL
ir direto para os GitHub Environments, sem passar por arquivo, terminal ou repositório.

#### Scenario: Projeto novo

- **WHEN** o mantenedor roda `scripts/neon-roles.ts --env production` num projeto sem os roles
- **THEN** o script cria `teko_app` e `teko_watch` e grava `NEON_PROD_APP_URL` (environment `maintenance`) e `NEON_PROD_WATCH_URL` (environment `corpus-watch`), sem imprimir nenhum valor
