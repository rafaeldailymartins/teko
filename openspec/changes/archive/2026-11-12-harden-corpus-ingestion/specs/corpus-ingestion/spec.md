# Spec Delta

## MODIFIED Requirements

### Requirement: Subcomando ingest load

`cli ingest load --target staging|production --plan <plan.json> --docling-dir <dir>` MUST aceitar
`--migrate` e `--bulk` só no staging e carregar as versões de cada documento em ordem de
`published_on`, com uma linha por item; no fim SHALL passar pelo gate de saúde, recalcular a
cobertura, exportar o snapshot se a versão do corpus mudou, atualizar o `corpus.lock.json` só se o
conteúdo mudou e gravar o relatório (`--report`).

#### Scenario: Fila de revisão no relatório

- **WHEN** o run deixa redações `pending` na fila
- **THEN** o relatório traz os itens abertos por família e motivo

#### Scenario: Segunda execução sem mudança

- **WHEN** o mesmo plano é carregado de novo
- **THEN** todas as versões voltam `unchanged`, nenhum embedding é chamado, nenhum snapshot é exportado e o `corpus.lock.json` não é reescrito

#### Scenario: Migração fora do staging

- **WHEN** o load é chamado com `--target production --migrate`
- **THEN** a CLI recusa com código 64, sem abrir run

### Requirement: Códigos de saída do load

O `load` MUST sair com 75 quando o orçamento de neurons ou a cota diária do provedor acabar (run
`budget_exhausted`, sem snapshot) e com 1 quando alguma fonte falhar ou o gate de saúde reprovar
(run `failed`, sem cobertura recalculada, snapshot nem lock), sem que a falha de uma fonte impeça as
demais.

#### Scenario: Orçamento esgotado

- **WHEN** `ingestDocumentVersion` devolve `budget_exhausted` no meio do plano
- **THEN** o load para, fecha o run como `budget_exhausted`, sai com 75, e o run seguinte com orçamento publica a partir do `embedding_cache`

#### Scenario: Fonte com erro

- **WHEN** o parser de uma fonte lança erro e as outras parseiam
- **THEN** as outras são ingeridas, o run fecha como `failed` com o erro no relatório e o código de saída é 1
