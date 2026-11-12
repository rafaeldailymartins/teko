# Spec Delta

## ADDED Requirements

### Requirement: Reordenação pelo reranker

Com o reranker configurado, a busca MUST pedir 30 candidatos à instrução híbrida, reordená-los pela
nota do reranker para a pergunta e devolver os 12 primeiros; sem reranker, SHALL devolver os 12
primeiros pela ordem do RRF. Falha do reranker ou mais de 2 s MUST manter a ordem do RRF, sem
falhar a pergunta, e o resultado SHALL indicar se foi reordenado.

#### Scenario: Campo sobe acima do registro-pai

- **WHEN** a pergunta é "Quais códigos de situação do documento são aceitos no registro C100?" e o RRF põe o registro C100 em 1º e o campo 06 em 2º
- **THEN** o reranker põe o campo 06 em 1º e o resultado é marcado como reordenado

#### Scenario: Reranker fora do ar

- **WHEN** o Workers AI responde erro para o reranker
- **THEN** a busca devolve os 12 primeiros na ordem do RRF, marcados como não reordenados
