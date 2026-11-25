## ADDED Requirements

### Requirement: Guarda de transferência do Neon

O `ingest.yml` MUST ler a transferência do período do `teko-staging` pela API do Neon antes de
qualquer job que toca o banco, nos modos `full` e `eval-only`, e SHALL parar o run com `::error`
quando ela passar de 80% dos 5 GB do Free ou não puder ser medida, salvo o input
`allow_high_transfer`, que deixa seguir com aviso. O resumo do run MUST trazer o número.

#### Scenario: Staging acima de 80%

- **WHEN** o `teko-staging` está com 4,1 GB de transferência no período e o run é disparado sem `allow_high_transfer`
- **THEN** o job `neon-transfer` falha com `::error`, discover, load e corpus-eval não rodam, e o resumo mostra 4,10 GB de 5 GB

#### Scenario: Liberação explícita

- **WHEN** o mesmo run é disparado com `allow_high_transfer: true`
- **THEN** a guarda avisa e o run segue

#### Scenario: Eval-only

- **WHEN** um `corpus-eval` é disparado pelo rótulo de um PR com o staging abaixo de 80%
- **THEN** a guarda roda antes do `corpus-eval`, que só começa depois do sucesso dela
