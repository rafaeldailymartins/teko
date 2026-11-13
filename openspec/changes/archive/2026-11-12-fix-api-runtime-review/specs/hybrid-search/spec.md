# Spec Delta

## MODIFIED Requirements

### Requirement: Degradação sem embedding

Se o embedding da pergunta falhar ou passar de 3 s, a busca MUST seguir só com os braços léxico e
da referência, rotulada `lexical_only`, sem falhar a pergunta; o cancelamento pelo cliente SHALL
continuar cancelando. Corpo de resposta ilegível (não JSON ou conexão encerrada durante a
leitura) MUST contar como falha do provedor.

#### Scenario: Provedor de embedding fora do ar

- **WHEN** o Workers AI responde erro para a pergunta
- **THEN** a busca devolve evidência com o modo `lexical_only`, ainda filtrada por vigência

#### Scenario: Corpo ilegível

- **WHEN** o Workers AI responde 200 com uma página HTML de erro, ou a conexão cai no meio do corpo
- **THEN** a busca degrada para `lexical_only` em vez de falhar a pergunta

### Requirement: Reordenação pelo reranker

Com o reranker configurado, a busca MUST pedir 40 candidatos à instrução híbrida, reordená-los pela
nota do reranker para a pergunta e devolver os 12 primeiros; sem reranker, SHALL devolver os 12
primeiros pela ordem do RRF. Falha do reranker (inclusive corpo ilegível) ou mais de 3 s MUST
manter a ordem do RRF, sem falhar a pergunta, e o resultado SHALL indicar se foi reordenado.

#### Scenario: Campo sobe acima do registro-pai

- **WHEN** a pergunta é "Quais códigos de situação do documento são aceitos no registro C100?" e o RRF põe o registro C100 em 1º e o campo 06 em 2º
- **THEN** o reranker põe o campo 06 em 1º e o resultado é marcado como reordenado

#### Scenario: Reranker fora do ar

- **WHEN** o Workers AI responde erro para o reranker
- **THEN** a busca devolve os 12 primeiros na ordem do RRF, marcados como não reordenados

## ADDED Requirements

### Requirement: Leitura resiliente à queda de conexão

As leituras idempotentes da API (busca e cobertura) MUST ser repetidas uma única vez, numa conexão
nova, quando a primeira tentativa cair com `57P01` ou `ECONNRESET` (scale-to-zero do Neon); a
conexão caída MUST NOT voltar ao pool. Escritas e transações com escrita MUST NOT ser repetidas.

#### Scenario: Neon suspendeu o compute

- **WHEN** a conexão do pool foi encerrada pelo Neon e a busca recebe `57P01`
- **THEN** a busca roda de novo numa conexão nova e devolve a evidência
