## ADDED Requirements

### Requirement: Exportação econômica do snapshot

O `ExportSnapshot` MUST ler o vetor dos chunks pelo binário do `halfvec_send` e gravar no arquivo o
texto canônico que o `halfvec_in` aceita, com o mesmo valor, sem mudar o formato do snapshot. Com
`reuseExisting`, SHALL devolver o manifesto já gravado da mesma versão do corpus e da mesma
migração sem ler as tabelas; manifesto ausente, ilegível ou de outra migração MUST levar à
exportação normal.

#### Scenario: Vetor em binário

- **WHEN** o snapshot é exportado e promovido num banco vazio
- **THEN** todo vetor da produção é igual ao do staging e o arquivo de chunks traz o vetor em texto

#### Scenario: Dois runs seguidos com a mesma versão e migração

- **WHEN** o `load` precisa exportar a versão 14 com a migração atual e o manifesto dela já está no store
- **THEN** nenhuma tabela é lida, o manifesto existente vai para o lock e o relatório marca o snapshot como reaproveitado

## MODIFIED Requirements

### Requirement: Subcomando ingest load

`cli ingest load --target staging|production --plan <plan.json> --docling-dir <dir>` MUST aceitar
`--migrate` e `--bulk` só no staging e carregar as versões de cada documento em ordem de
`published_on`, com uma linha por item; no fim SHALL passar pelo gate de saúde, recalcular a
cobertura, exportar o snapshot quando a versão do corpus ou a migração do banco mudou, atualizar
o `corpus.lock.json` só se o conteúdo mudou e gravar o relatório (`--report`).

#### Scenario: Fila de revisão no relatório

- **WHEN** o run deixa redações `pending` na fila
- **THEN** o relatório traz os itens abertos por família e motivo

#### Scenario: Segunda execução sem mudança

- **WHEN** o mesmo plano é carregado de novo
- **THEN** todas as versões voltam `unchanged`, nenhum embedding é chamado, nenhum snapshot é exportado, a poda do `embedding_cache` não roda e o `corpus.lock.json` não é reescrito

#### Scenario: Migração fora do staging

- **WHEN** o load é chamado com `--target production --migrate`
- **THEN** a CLI recusa com código 64, sem abrir run
