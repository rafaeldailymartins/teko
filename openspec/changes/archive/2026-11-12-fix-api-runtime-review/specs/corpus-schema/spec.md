# Spec Delta

## MODIFIED Requirements

### Requirement: Escrita atômica do corpus

A escrita do corpus MUST acontecer uma versão de documento por transação, pelo
`IngestDocumentVersion` (documento, versão, dispositivos, redações, chunks e fontes), e SHALL
falhar inteira se algum chunk publicável ficar sem versão de documento publicada; o
`RefreshCoverage` grava a cobertura e a nova `corpus_versions` no fim do run. O seed da fixture
MUST usar esse mesmo caminho, e o container HTTP MUST NOT montar escrita do corpus.

#### Scenario: Semente da fixture

- **WHEN** o `cli seed-fixtures` grava a fixture única num banco migrado
- **THEN** o corpus fica com uma `corpus_versions`, a cobertura das seis famílias e todo chunk com embedding e fonte publicada

#### Scenario: Semente repetida

- **WHEN** o `cli seed-fixtures` roda de novo sobre o mesmo banco
- **THEN** toda versão de documento sai `unchanged`, e nenhuma linha nem `corpus_versions` nova é gravada
