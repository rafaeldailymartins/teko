# Spec Delta

## ADDED Requirements

### Requirement: Reescrita da pergunta pelo LLM

Com `QUERY_REWRITE_ENABLED` e uma cadeia de LLM, a busca MUST pedir à cadeia, antes do embedding,
uma consulta em português na linguagem do corpus para a pergunta já redigida, com a política
regional da resposta. O braço léxico SHALL receber a pergunta e a consulta; o embedding e o
reranker, a consulta. O resultado SHALL trazer a consulta usada.

#### Scenario: Pergunta na linguagem de contador

- **WHEN** a reescrita está ligada e a pergunta é "Qual era a alíquota geral do ICMS nas vendas dentro de Goiás?"
- **THEN** o LLM recebe a pergunta entre `<pergunta>` e `</pergunta>`, a busca usa a consulta devolvida e o resultado a informa

#### Scenario: Usuário do EEE

- **WHEN** a reescrita está ligada e a pergunta vem de um usuário do EEE, do Reino Unido ou da Suíça
- **THEN** só modelos com ZDR recebem a pergunta para reescrever

### Requirement: Degradação da reescrita

Falha da cadeia de LLM, mais de 4 s ou saída vazia na reescrita MUST seguir com a pergunta
original, sem falhar a pergunta, e o resultado SHALL vir sem consulta. A recusa fora da cobertura
MUST acontecer antes da reescrita.

#### Scenario: Cadeia de LLM fora do ar

- **WHEN** a reescrita está ligada e todos os modelos da cadeia falham
- **THEN** a busca segue com a pergunta original e o resultado não traz consulta

#### Scenario: Fora da cobertura

- **WHEN** a reescrita está ligada e a data de referência está fora da cobertura
- **THEN** a pergunta é recusada sem nenhuma chamada ao LLM
