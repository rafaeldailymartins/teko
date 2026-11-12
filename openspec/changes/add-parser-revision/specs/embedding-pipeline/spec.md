# Spec Delta

## MODIFIED Requirements

### Requirement: Reingestão sem efeito

A ingestão MUST tratar uma versão de documento cujo sha256 já está publicado, com revisão do parser
igual ou maior que a atual, como `unchanged`, sem gravar linhas nem chamar o provedor de embeddings,
e SHALL reaproveitar as redações de um arquivo novo com o mesmo conteúdo, acrescentando só as
fontes. Uma versão publicada com revisão do parser menor que a atual MUST ser reprocessada pela
reconciliação, reaproveitando as redações iguais e fechando o `knowledge` das que mudaram.

#### Scenario: Mesma versão duas vezes

- **WHEN** o RCTE consolidado até um decreto é ingerido num run e de novo no run seguinte
- **THEN** o segundo run devolve `unchanged`, o número de linhas do schema `corpus` não muda e o run grava 0 neurons

#### Scenario: Novo download com o mesmo conteúdo

- **WHEN** chega um arquivo com outro sha256 e as mesmas redações
- **THEN** nenhuma redação nem chunk é criado, nenhum texto é embutido, e cada chunk passa a ter as duas versões de documento como fonte

#### Scenario: Parser corrigido depois da publicação

- **WHEN** o Guia 3.1.9 foi publicado com a revisão 1 do `docling-guia` e o parser atual tem a revisão 2
- **THEN** o run seguinte reprocessa a mesma versão de documento: as redações iguais ficam, as que mudaram têm o `knowledge` fechado, as novas entram e a versão passa a registrar a revisão 2
