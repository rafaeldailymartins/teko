# Spec Delta

## ADDED Requirements

### Requirement: Revisão do extrator

O manifesto MUST gravar a revisão do extrator (`extractor_revision`, ausente na leitura = 1), e a
chave do store `corpus-docling` SHALL incluí-la a partir da revisão 2 (a 1 é a chave sem sufixo);
a versão do `docling` no `uv.lock` MUST ser a coberta pela revisão vigente.

#### Scenario: Docling atualizado

- **WHEN** o `uv.lock` passa a fixar outra versão do `docling` sem a revisão do extrator mudar
- **THEN** os testes do `tools/ingest` e da API falham

#### Scenario: Revisão inicial

- **WHEN** o `discover` procura a parte de um PDF já extraído antes da revisão existir
- **THEN** a chave é a mesma de antes e a parte não é reextraída
