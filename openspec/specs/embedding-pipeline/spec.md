# embedding-pipeline Specification

## Purpose

Define como a ingestão publica cada versão de documento de forma incremental, com embeddings sob o
orçamento diário de neurons, e como o corpus do staging vira um snapshot promovível para a produção.

## Requirements

### Requirement: Reingestão sem efeito

A ingestão MUST tratar uma versão de documento cujo sha256 já está publicado, com revisão do parser
igual ou maior que a atual, como `unchanged`, sem gravar linhas nem chamar o provedor de embeddings,
e SHALL tratar do mesmo jeito um sha256 novo com a impressão digital de uma versão publicada.
Uma versão publicada com revisão do parser menor que a atual MUST ser reprocessada.

#### Scenario: Mesma versão duas vezes

- **WHEN** o RCTE consolidado até um decreto é ingerido num run e de novo no run seguinte
- **THEN** o segundo run devolve `unchanged`, o número de linhas do schema `corpus` não muda e o run grava 0 neurons

#### Scenario: Página regravada sem mudança

- **WHEN** o RCTE chega com outro sha256 e o mesmo rótulo, metadados e redações da versão publicada
- **THEN** a versão volta `unchanged` com o motivo `fingerprint`, sem versão de documento, fontes ou raw novos e fora do `corpus.lock.json`

#### Scenario: Novo download com o mesmo conteúdo

- **WHEN** chega um arquivo com outro sha256, outro rótulo de versão e as mesmas redações
- **THEN** nenhuma redação nem chunk é criado, nenhum texto é embutido, e cada chunk passa a ter as duas versões de documento como fonte

#### Scenario: Parser corrigido depois da publicação

- **WHEN** o Guia 3.1.9 foi publicado com a revisão 1 do `docling-guia` e o parser atual tem a revisão 2
- **THEN** o run seguinte reprocessa a mesma versão de documento: as redações iguais ficam, as que mudaram têm o `knowledge` fechado no dia seguinte ao `published_on`, as novas entram a partir desse dia e a versão passa a registrar a revisão 2

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
`EMBED_NEURON_BUDGET` do dia UTC (o da cota do Workers AI), com `budget_exhausted` e sem publicar a
versão. A cota diária do provedor esgotada (HTTP 429, código 3036) MUST ter o mesmo efeito, sem
nova tentativa.

#### Scenario: Orçamento esgotado e retomada

- **WHEN** um run com orçamento de 1 neuron embute o primeiro lote e para, e o run seguinte tem orçamento
- **THEN** o primeiro devolve `budget_exhausted` sem nenhuma versão publicada, e o segundo publica a versão embutindo só os textos que faltavam

#### Scenario: Cota do provedor esgotada

- **WHEN** o Workers AI responde 429 com o código 3036 no meio do run
- **THEN** nenhum lote novo começa, a versão volta `budget_exhausted` e o `load` sai com 75

#### Scenario: Dimensão errada

- **WHEN** o provedor devolve vetores com outra dimensão que não 1.024
- **THEN** a ingestão falha antes de gravar o lote no cache

### Requirement: Guarda de tamanho

A ingestão MUST abortar antes de gravar uma versão quando `pg_database_size` passar do limite
(800 MB por padrão) e SHALL abortar antes de embutir quando o tamanho mais os chunks novos da versão
ao tamanho médio por chunk (`INGEST_BYTES_PER_CHUNK`, padrão 10.854 bytes) passar do limite.

#### Scenario: Banco acima do limite

- **WHEN** o limite configurado é menor que o tamanho do banco
- **THEN** a ingestão falha com `DatabaseSizeLimitError` sem chamar os embeddings nem gravar a versão

#### Scenario: Versão grande demais

- **WHEN** o banco está abaixo do limite mas os chunks novos da versão o levariam acima
- **THEN** a ingestão falha com `DatabaseSizeLimitError` com a projeção, antes de chamar os embeddings

### Requirement: Cobertura no fim do run

O `RefreshCoverage` MUST recalcular `covered` como a união das vigências das redações publicáveis
atuais das famílias atualizadas (as do run e as com chunks ainda sem versão do corpus), gravar
`verified_at` com a data do run, tirar só as lacunas resolvidas por versão de documento criada
depois da detecção e gravar um `corpus_versions` novo por último; um run `failed` SHALL não chamá-lo.

#### Scenario: Família atualizada

- **WHEN** o run publicou uma versão do RCTE e o `RefreshCoverage` roda com a data 2026-11-10
- **THEN** `coverage` do RCTE tem `verified_at` 2026-11-10 e nenhum chunk fica sem versão do corpus

#### Scenario: Run que falhou

- **WHEN** uma fonte falha e outra é publicada no mesmo run
- **THEN** o run fecha `failed` sem `corpus_versions` novo, e o run verde seguinte recalcula a cobertura da família publicada

### Requirement: Snapshot verificável

A exportação MUST gravar um arquivo `.jsonl.zst` por tabela do schema `corpus`, na ordem de FK, sem
`embedding_cache`, `ingestion_runs`, `review_queue` nem linhas `pending`/`rejected`, sem o vetor de
chunk de conhecimento fechado, e um `manifest.json` com contagens, sha256 de cada arquivo, o hash
da última migração e a linhagem (commit, modelo de embedding, revisões do parser e do extrator,
versão do Docling e reranker), mantendo os 3 snapshots mais recentes e o do lock vigente.

#### Scenario: Retenção

- **WHEN** o staging exporta as versões 3, 4 e 5 do corpus com o lock vigente na versão 1
- **THEN** o store `corpus-snapshots` guarda as versões 1, 3, 4 e 5

### Requirement: Promoção idêntica e segura

A promoção MUST recusar o snapshot se a migração do destino for diferente, se o destino estiver
numa versão mais nova (salvo `--rollback`) ou se o sha256 de algum arquivo não conferir, e SHALL
aplicar o snapshot numa transação, sem recalcular embeddings, com o `verified_at` mais recente dos
dois e as lacunas do snapshot mais as do destino detectadas depois da exportação.

#### Scenario: Banco vazio

- **WHEN** o snapshot da fixture é promovido num banco vazio
- **THEN** a busca híbrida devolve, para todas as perguntas do golden, os mesmos resultados do staging, na mesma ordem

#### Scenario: Arquivo adulterado

- **WHEN** um byte de um arquivo do snapshot muda no store
- **THEN** a promoção falha antes de escrever no destino

#### Scenario: Promoção repetida

- **WHEN** o mesmo snapshot é promovido duas vezes
- **THEN** as contagens de todas as tabelas ficam iguais

#### Scenario: Lacuna já ingerida pelo staging

- **WHEN** o `verified_at` da produção avançou depois da ingestão e o snapshot vem sem a lacuna que o staging resolveu
- **THEN** a produção fica sem a lacuna, com o `verified_at` dela

### Requirement: Disjuntor de mudança em massa

A ingestão MUST falhar o item, antes de embutir e de gravar, quando a versão fechar mais de 20% das
redações abertas que cruzam a janela, deixar mais de 10% dos dispositivos sem redação aberta ou
dobrar a fração `pending` (com alta de 2 pontos percentuais), havendo ao menos 20 redações na base;
`--accept-churn` SHALL publicar mesmo assim, com as métricas no relatório.

#### Scenario: Parser quebrado

- **WHEN** uma versão nova do RCTE deixa sem redação 30% dos artigos publicados
- **THEN** o item falha com as métricas, nada é embutido nem gravado e o run fecha `failed`

### Requirement: Gate de saúde do corpus

O `load` MUST comparar, num run sem falha e sem orçamento esgotado, o estado publicado de cada
documento (dispositivos, chunks e `pending`) com o `health` do `corpus.lock.json`, e SHALL reprovar
o run com queda acima de 5% num documento, documento que sumiu ou fração `pending` de uma família
acima de `--max-pending-share` (padrão 0,15) e maior que antes, salvo `--accept-churn`.

#### Scenario: Chunks caem

- **WHEN** o lock registra 200 chunks publicáveis do RCTE e o run termina com 150
- **THEN** o run fecha `failed` com o motivo no relatório, sem snapshot nem lock novo

### Requirement: Vetor só no conhecimento aberto

O vetor de um chunk MUST ser apagado quando o conhecimento dele fecha (na ingestão, depois de os
recortes o copiarem, e na promoção), o HNSW e o GIN de `corpus.chunks` SHALL ser parciais
(`WHERE upper_inf(knowledge)`), e um run verde que cobriu todas as famílias SHALL apagar do
`embedding_cache` os vetores que nenhum chunk aberto usa.

#### Scenario: Consolidado que fecha redações

- **WHEN** um consolidado novo fecha o conhecimento de redações publicadas
- **THEN** nenhum chunk fechado tem vetor e todo chunk aberto tem

### Requirement: Rollback de corpus

`snapshot promote --rollback` MUST repromover um snapshot mais antigo que o destino como uma
`corpus_version` nova, aceitando a migração dele se já foi aplicada no destino, e SHALL recusar o
rollback de um snapshot que não é mais antigo.

#### Scenario: Snapshot ruim promovido

- **WHEN** a produção está na versão 2 e o snapshot 1 é repromovido com `--rollback`
- **THEN** a produção vai para a versão 3 com o conteúdo do snapshot 1, e as redações que a versão 2 fechou voltam abertas com o vetor
