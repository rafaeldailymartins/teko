# Spec Delta

## Purpose

Define como a ingestão publica cada versão de documento de forma incremental, com embeddings sob o
orçamento diário de neurons, e como o corpus do staging vira um snapshot promovível para a produção.

## ADDED Requirements

### Requirement: Reingestão sem efeito

A ingestão MUST tratar uma versão de documento cujo sha256 já está publicado como `unchanged`, sem
gravar linhas nem chamar o provedor de embeddings, e SHALL reaproveitar as redações de um arquivo
novo com o mesmo conteúdo, acrescentando só as fontes.

#### Scenario: Mesma versão duas vezes

- **WHEN** o RCTE consolidado até um decreto é ingerido num run e de novo no run seguinte
- **THEN** o segundo run devolve `unchanged`, o número de linhas do schema `corpus` não muda e o run grava 0 neurons

#### Scenario: Novo download com o mesmo conteúdo

- **WHEN** chega um arquivo com outro sha256 e as mesmas redações
- **THEN** nenhuma redação nem chunk é criado, nenhum texto é embutido, e cada chunk passa a ter as duas versões de documento como fonte

### Requirement: Reconciliação por janela de substituição

A ingestão MUST reconciliar cada dispositivo com as redações de conhecimento aberto: reaproveitar a
idêntica, alargar a de mesmo conteúdo cuja vigência fica contígua (sem nunca encolher), fechar o
`knowledge` em `published_on` da redação que cruza a janela reescrita e não aparece na versão nova,
recriando os trechos fora da janela com os mesmos chunks e embeddings; e SHALL fechar o
`valid_during` da versão de documento anterior ainda aberta.

#### Scenario: Consolidado novo

- **WHEN** um RCTE publicado em 2026-06-01 traz a redação de um artigo com vigência a partir de 2005 que antes ia até 2020 e omite a redação que vigorava desde 2020
- **THEN** a primeira redação é alargada na mesma linha, a segunda tem o conhecimento fechado em 2026-06-01, e o consolidado anterior passa a valer até 2026-06-01

#### Scenario: Versão corretiva de um Guia

- **WHEN** a corretiva do período de 2026 omite um campo que vinha de 2025 com o mesmo texto
- **THEN** a linha antiga fecha em `published_on` e uma linha nova mantém a vigência de 2025, sem nenhuma chamada de embedding

### Requirement: Anomalia não bloqueia a publicação

Uma redação `pending` (anomalia de vigência) MUST ser publicada junto com o documento, mesmo
sobreposta a redações publicáveis do mesmo dispositivo, e SHALL abrir um único item aberto na
`review_queue` por `(stable_key, note_hash)`.

#### Scenario: Anomalia sobreposta

- **WHEN** um documento traz duas redações `auto` contíguas de um artigo e uma anomalia `pending` que cruza as duas
- **THEN** a versão é publicada com as três redações e a fila tem 1 item com a vigência proposta

#### Scenario: Reingestão da anomalia

- **WHEN** o mesmo documento é ingerido de novo de outro arquivo
- **THEN** a fila continua com 1 item

### Requirement: Embeddings sob orçamento diário

A ingestão MUST embutir só os textos ausentes do `embedding_cache`, gravando cada lote no cache e o
custo real no run antes do próximo, e SHALL parar antes do lote que não couber no
`EMBED_NEURON_BUDGET` do dia de `America/Sao_Paulo`, com `budget_exhausted` e sem publicar a versão.

#### Scenario: Orçamento esgotado e retomada

- **WHEN** um run com orçamento de 1 neuron embute o primeiro lote e para, e o run seguinte tem orçamento
- **THEN** o primeiro devolve `budget_exhausted` sem nenhuma versão publicada, e o segundo publica a versão embutindo só os textos que faltavam

#### Scenario: Dimensão errada

- **WHEN** o provedor devolve vetores com outra dimensão que não 1.024
- **THEN** a ingestão falha antes de gravar o lote no cache

### Requirement: Guarda de tamanho

A ingestão MUST abortar antes de gravar uma versão quando `pg_database_size` passar do limite
(800 MB por padrão).

#### Scenario: Banco acima do limite

- **WHEN** o limite configurado é menor que o tamanho do banco
- **THEN** a ingestão falha com `DatabaseSizeLimitError` sem chamar os embeddings nem gravar a versão

### Requirement: Cobertura no fim do run

O `RefreshCoverage` MUST recalcular `covered` como a união das vigências das redações publicáveis
atuais das famílias atualizadas, gravar `verified_at` com a data do run, limpar as lacunas e gravar
um `corpus_versions` novo por último.

#### Scenario: Família atualizada

- **WHEN** o run publicou uma versão do RCTE e o `RefreshCoverage` roda com a data 2026-11-10
- **THEN** `coverage` do RCTE tem `verified_at` 2026-11-10, sem lacunas, e nenhum chunk fica sem versão do corpus

### Requirement: Snapshot verificável

A exportação MUST gravar um arquivo `.jsonl.zst` por tabela do schema `corpus`, na ordem de FK, sem
`embedding_cache`, `ingestion_runs`, `review_queue` nem linhas `pending`/`rejected`, e um
`manifest.json` com contagens, sha256 de cada arquivo e o hash da última migração, mantendo só os
3 snapshots mais recentes.

#### Scenario: Retenção

- **WHEN** o staging exporta as versões 1, 2, 3 e 4 do corpus
- **THEN** o store `corpus-snapshots` guarda só as versões 2, 3 e 4

### Requirement: Promoção idêntica e segura

A promoção MUST recusar o snapshot se a migração do destino for diferente, se o destino estiver
numa versão mais nova ou se o sha256 de algum arquivo não conferir, e SHALL aplicar o snapshot numa
transação, sem recalcular embeddings, preservando o `verified_at` e o `gap_reason` do destino quando
forem mais recentes.

#### Scenario: Banco vazio

- **WHEN** o snapshot da fixture é promovido num banco vazio
- **THEN** a busca híbrida devolve, para todas as perguntas do golden, os mesmos resultados do staging, na mesma ordem

#### Scenario: Arquivo adulterado

- **WHEN** um byte de um arquivo do snapshot muda no store
- **THEN** a promoção falha antes de escrever no destino

#### Scenario: Promoção repetida

- **WHEN** o mesmo snapshot é promovido duas vezes
- **THEN** as contagens de todas as tabelas ficam iguais
