## RENAMED Requirements

- FROM: `### Requirement: Trace rag-query com o trace_id do OTel`
- TO: `### Requirement: Trace answer-question com o trace_id do OTel

Cada pergunta amostrada MUST virar um trace `answer-question` com o `trace_id` do OTel (o do
`x-trace-id`) e nomes estáveis com verbo no início. A raiz MUST ter a pergunta redigida como
entrada, a resposta como saída e o contexto (data, famílias, desfecho, recusa e citações usadas com
o trecho) na metadata. Acerto do cache e recusa por cobertura SHALL gerar só a raiz. Uma falha do
adapter SHALL NOT afetar a resposta.

#### Scenario: Mesmo trace_id

- **WHEN** uma pergunta amostrada é respondida pelo stream
- **THEN** o `x-trace-id` da resposta é o id do trace `answer-question` no Langfuse

#### Scenario: Acerto do cache

- **WHEN** a pergunta é respondida pelo cache exato no `POST`
- **THEN** o trace tem só a raiz `answer-question`, com `cached=true`, a pergunta na entrada e a
  resposta do cache na saída

#### Scenario: Falha da cadeia de LLM

- **WHEN** a cadeia de LLM fica indisponível no stream de uma pergunta amostrada
- **THEN** a raiz sai sem saída, com nível `ERROR` e o código do erro na mensagem de status

### Requirement: Uma generation por provedor tentado

O trace MUST ter uma generation por provedor tentado (`generate-answer` e, com a reescrita ligada,
`rewrite-query`) com as mensagens `system` e `user` no formato da OpenAI na entrada, a mensagem do
assistente na saída, a versão do prompt, `usageDetails`, `costDetails` a preço de tabela,
`metadata.billed_usd=0` e o tempo até o primeiro token. A tentativa que falhou antes do primeiro
token SHALL vir com `level=ERROR`, o tipo da falha e custo 0.

#### Scenario: Fallback antes do primeiro token

- **WHEN** o Gemini primário responde 429 e o de fallback responde
- **THEN** o trace tem duas generations `generate-answer`: a primeira com `level=ERROR` e
  `rate_limited`, sem custo, e a segunda com uso, custo e TTFT

## ADDED Requirements

### Requirement: Sessão e atributos de correlação em toda observation

O usuário só por hash, o id da conversa como `sessionId`, as tags e a metadata curta do trace MUST
ir em todas as observations do trace, não só na raiz.

#### Scenario: Turnos de uma conversa

- **WHEN** o usuário faz duas perguntas amostradas na mesma conversa
- **THEN** os dois traces têm o id da conversa como `sessionId` e aparecem na mesma sessão

#### Scenario: Filtro por usuário nas observations

- **WHEN** alguém filtra as generations pelo `userId` em hash
- **THEN** aparecem as generations das perguntas desse usuário, sem juntar com o trace

### Requirement: Retriever com a consulta e os itens recuperados

O retriever `retrieve-context` MUST ter na entrada a consulta redigida, a reescrita (quando houve),
a data de referência e as famílias, e na saída os dispositivos recuperados na ordem final (chave,
rótulo, caminho, versão, vigência, RRF e posição em cada braço), sem o texto, que vai no prompt.

#### Scenario: Busca com a pergunta reescrita

- **WHEN** a reescrita está ligada e a busca usa a consulta reescrita
- **THEN** o retriever mostra a pergunta e a consulta reescrita na entrada e os dispositivos
  recuperados, com RRF e posições, na saída

### Requirement: Raciocínio do modelo na generation

Quando o modelo devolve raciocínio (o resumo do Gemini ou o texto do `gpt-oss`), a generation MUST
trazê-lo num item `reasoning` antes da mensagem do assistente, sem mudar o fallback nem o tempo até
o primeiro token, que continuam decididos pelo primeiro texto.

#### Scenario: Modelo que pensa antes de responder

- **WHEN** o modelo devolve raciocínio antes do texto da resposta
- **THEN** a generation mostra o raciocínio antes da resposta, e o primeiro token e o fallback
  continuam contados pelo texto
