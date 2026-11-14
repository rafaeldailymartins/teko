# Spec Delta

## MODIFIED Requirements

### Requirement: Reescrita da pergunta pelo LLM

Com `QUERY_REWRITE_ENABLED` e uma cadeia de LLM, a busca MUST pedir à cadeia, antes do embedding,
uma consulta em português na linguagem do corpus para a pergunta já redigida, com a política
regional da resposta. O braço léxico SHALL receber a pergunta e a consulta; o embedding e o
reranker SHALL receber só a pergunta. O resultado SHALL trazer a consulta usada.

#### Scenario: Pergunta na linguagem de contador

- **WHEN** a reescrita está ligada e a pergunta é "Qual era a alíquota geral do ICMS nas vendas dentro de Goiás?"
- **THEN** o LLM recebe a pergunta entre `<pergunta>` e `</pergunta>`, o braço léxico usa a pergunta e a consulta devolvida, o embedding e o reranker usam a pergunta, e o resultado informa a consulta

#### Scenario: Usuário do EEE

- **WHEN** a reescrita está ligada e a pergunta vem de um usuário do EEE, do Reino Unido ou da Suíça
- **THEN** só modelos com ZDR recebem a pergunta para reescrever
