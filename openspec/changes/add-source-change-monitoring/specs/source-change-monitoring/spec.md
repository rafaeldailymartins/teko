# Spec Delta

## Purpose

Define como o Tekó confere diariamente as fontes oficiais do corpus, detecta versões novas e
mantém a cobertura (`verified_at`, `gaps`, `gap_reason`) coerente com o que foi verificado.

## ADDED Requirements

### Requirement: GET condicional das páginas monitoradas

O `sources-watch` MUST buscar cada página do `corpus/watch.yaml` pelo SafeFetcher com
`If-None-Match` e `If-Modified-Since` guardados em `corpus-manifests/watch-state.json`, e SHALL
manter o estado da página quando a resposta é `304`.

#### Scenario: Página sem mudança

- **WHEN** o `RCTE.htm` responde `304` ao ETag guardado
- **THEN** nenhuma mudança é reportada e só o `checkedOn` da página avança

### Requirement: Sinal de versão nova

O `sources-watch` MUST reportar em `discovered.json`, com `family`, `sourceUrl`, `effectiveFrom`,
`versionLabel` e `kind`: o rótulo novo de um consolidado ("CONSOLIDADO ATÉ O DECRETO Nº …"), um
ato novo de uma lista de atos, um documento novo de um índice e uma tabela do WS com `versao` ou
`hash` novos; a primeira observação de uma página SHALL só gravar a linha de base.

#### Scenario: Decreto consolidado

- **WHEN** o cabeçalho do RCTE passa de "Decreto nº 10.986, de 16.09.26" para "Decreto nº 10.991, de 07.10.26"
- **THEN** o `discovered.json` traz uma mudança `consolidated` da família `rcte` com `effectiveFrom` 2026-10-07

#### Scenario: Tabela nova no WS

- **WHEN** a tabela 37 do WS passa da versão 151 para a 152
- **THEN** o `discovered.json` traz uma mudança `table` da família `tabelas-go` com o `dtVersao` da versão 152

#### Scenario: Primeiro run

- **WHEN** o `watch-state.json` ainda não existe
- **THEN** o run grava o estado de todas as páginas e o `discovered.json` não traz mudança

### Requirement: Ato pendente até o consolidado

Um ato novo de uma lista de atos MUST continuar reportado (como `pending`) a cada run enquanto o
número dele for maior que o do último ato consolidado da família, e SHALL deixar de ser reportado
quando o consolidado o alcançar.

#### Scenario: Decreto publicado antes da consolidação

- **WHEN** o sumário de 2026 lista o Decreto nº 10.995 e o RCTE continua consolidado até o 10.986
- **THEN** o 10.995 é reportado como `new` no primeiro run e como `pending` nos seguintes, até o cabeçalho do RCTE chegar a 10.995

### Requirement: Avanço diário do verified_at

O `mark-coverage` MUST, sem mudança detectada e sem erro de verificação, executar em cada banco
(teko-prod e teko-staging, role `teko_watch`) exatamente um
`UPDATE corpus.coverage SET verified_at = <data do run> WHERE verified_at < <data do run>`, com a
data do run em `America/Sao_Paulo`.

#### Scenario: Dia sem mudança

- **WHEN** nenhuma fonte mudou e todas as páginas foram verificadas em 2026-11-11
- **THEN** cada banco recebe um único `UPDATE` e toda família com `verified_at` anterior passa a 2026-11-11

### Requirement: Lacuna a partir da data de efeito

Com mudança detectada numa família, o `mark-coverage` MUST acrescentar a `gap_entries` uma entrada
com `[effectiveFrom, ∞)` (a menor data de efeito detectada) e SHALL regravar `gaps` e `gap_reason`
como a soma das entradas, na mesma transação do avanço de `verified_at`.

#### Scenario: Decreto novo no RCTE

- **WHEN** o `discovered.json` traz o Decreto nº 10.995 com `effectiveFrom` 2026-11-10
- **THEN** a cobertura do `rcte` ganha a lacuna `[2026-11-10,)` e o `gap_reason` cita o decreto

### Requirement: Entrada de lacuna com fonte e detecção

Cada entrada de lacuna MUST trazer os documentos que a resolvem (`covers` da página ou do padrão
no `corpus/watch.yaml`; vazio = qualquer documento da família) e o instante da detecção
(`generatedAt` do `discovered.json`); a mesma lacuna detectada de novo SHALL manter a primeira
detecção.

#### Scenario: Guia e Nota Técnica na mesma família

- **WHEN** o índice do SPED traz o Guia 3.2.5 e a NT 2026.004 da EFD ICMS/IPI
- **THEN** `gap_entries` tem uma entrada resolvida por `guia-pratico-efd-icms-ipi` e outra por `notas-tecnicas-efd-icms-ipi`

### Requirement: Lacuna limpa pela fonte que a causou

A ingestão MUST limpar, no `RefreshCoverage`, só as entradas de lacuna cujo documento ganhou no run
uma versão publicada criada depois da detecção; publicar outro documento da família, ou reprocessar
uma versão já existente pela revisão do parser, SHALL manter a lacuna.

#### Scenario: Reprocessamento pela revisão do parser

- **WHEN** a lacuna do Guia 3.2.5 está aberta e o run só reprocessa o Guia 3.2.4 com a revisão nova do parser
- **THEN** a lacuna continua em `gap_entries`, `gaps` e `gap_reason`

#### Scenario: Versão nova do documento

- **WHEN** o run publica o RCTE consolidado até o Decreto nº 10.995, baixado depois da detecção
- **THEN** a entrada do decreto sai de `gap_entries` e as entradas de outros documentos ficam

### Requirement: Lacuna na promoção decidida pela detecção

A promoção MUST gravar na produção as entradas de lacuna do snapshot mais as do destino detectadas
depois da exportação do snapshot (`createdAt` do manifesto), e SHALL manter o `verified_at` mais
recente dos dois; uma lacuna do destino detectada antes da exportação e ausente do snapshot já foi
resolvida pelo staging e sai.

#### Scenario: Staging já ingeriu a mudança

- **WHEN** o `mark-coverage` avançou o `verified_at` da produção depois da ingestão e o snapshot vem sem a lacuna que o staging resolveu
- **THEN** a produção fica sem a lacuna e mantém o `verified_at` dela

#### Scenario: Mudança detectada depois da exportação

- **WHEN** a lacuna da produção foi detectada depois do `createdAt` do snapshot
- **THEN** a lacuna continua na produção depois da promoção

### Requirement: Família não verificada

Uma página que não pôde ser verificada (erro de rede, bloqueio, status inesperado ou sinal
ausente) MUST deixar a família fora do avanço de `verified_at` naquele run, e o workflow SHALL
terminar vermelho depois de marcar as demais famílias.

#### Scenario: WS fora do ar

- **WHEN** o WS de Tabelas Externas responde 503
- **THEN** o `verified_at` de `tabelas-go` não avança, as outras famílias avançam e o job `watch-errors` falha

### Requirement: Privilégio mínimo do mark-coverage

O role `teko_watch` MUST poder só ler `corpus.coverage` e atualizar `verified_at`, `gaps`,
`gap_reason` e `gap_entries`; o job `mark-coverage` SHALL rodar no environment `corpus-watch` só com
`NEON_PROD_WATCH_URL` e `NEON_STAGING_WATCH_URL`, e o job `detect` (com o PAT da Netlify) SHALL
não tocar o banco.

#### Scenario: Escrita fora do permitido

- **WHEN** o `teko_watch` tenta atualizar `covered`, inserir ou apagar linhas de cobertura ou ler `corpus.documents`
- **THEN** o Postgres recusa com `permission denied` (42501)

### Requirement: Ingestão disparada por fonte live

Uma mudança nova numa página `live` MUST disparar o `ingest.yml` no staging (só a família, se
for uma), e uma página `pinned` SHALL só registrar a mudança e a lacuna.

#### Scenario: Guia novo da EFD-GO

- **WHEN** o índice do Guia EFD-GO ganha o link da versão 6.0
- **THEN** o `detect` expõe a família `efd-go` e o job `ingest` chama o `ingest.yml` com `target=staging` e `family=efd-go`
