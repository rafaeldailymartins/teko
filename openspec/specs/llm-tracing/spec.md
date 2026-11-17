# llm-tracing Specification

## Purpose

Define os traces de LLM do Tekó no Langfuse Cloud: o processor no mesmo provider do OTel, a
amostragem pelo `questionId` com corte de units, o trace `answer-question` com as generations e o
custo de tabela, o feedback, o apagamento com a conta e o job do `ops.yml`.

## Requirements

### Requirement: Langfuse só com chaves, no mesmo provider do OTel

A API MUST criar o `LangfuseSpanProcessor` no mesmo provider de traces do OTel só com
`LANGFUSE_PUBLIC_KEY` e `LANGFUSE_SECRET_KEY` presentes e `LLM_TRACING_BACKEND=langfuse` (o padrão);
sem as duas chaves, ou com `off`, nenhum span SHALL ir ao Langfuse. O processor MUST exportar só os
spans do SDK do Langfuse e passar entrada, saída e metadata pelo `PiiRedactor`. Staging e produção
MUST exigir `LANGFUSE_BASE_URL` em https, e as chaves SHALL vir aos pares.

#### Scenario: CI sem chaves

- **WHEN** a API sobe sem `LANGFUSE_PUBLIC_KEY`
- **THEN** nenhum processor extra entra no provider e nenhuma observation é criada

#### Scenario: Span de LLM do adapter

- **WHEN** uma pergunta amostrada chama o modelo, que abre o span `chat <modelo>` com `gen_ai.*`
- **THEN** o span vai ao Grafana e não ao Langfuse, que recebe a generation `generate-answer`

#### Scenario: PII que escapou da redação

- **WHEN** uma observation leva um CPF válido na entrada
- **THEN** o Langfuse recebe `[CPF]` no lugar do número

### Requirement: Amostragem pelo questionId com corte de units

O `TraceSampler` MUST decidir no início do trace `answer-question` pelo hash do `questionId`, de
forma determinística e independente da flag `sampled` do navegador, com a taxa do ambiente (padrão:
produção 1,0, staging 0,1, CI 0) enquanto a projeção linear do mês de
`usage_daily.langfuse_units` ficar abaixo de `LANGFUSE_MONTHLY_UNITS_CUTOFF` (35k), e a taxa
reduzida (0,2, nunca acima da do ambiente) a partir dele ou quando a leitura falhar. Pergunta não
amostrada SHALL NOT criar observation.

#### Scenario: Produção acima do corte

- **WHEN** a produção projeta 40 mil units no mês
- **THEN** cerca de 20% das perguntas viram trace, sempre as mesmas para os mesmos `questionId`

#### Scenario: Banco fora do ar na leitura das units

- **WHEN** a soma de `langfuse_units` falha
- **THEN** vale a taxa reduzida e a pergunta segue normalmente

### Requirement: Trace answer-question com o trace_id do OTel

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

### Requirement: Raciocínio do modelo na generation

Quando o modelo devolve raciocínio (o resumo do Gemini ou o texto do `gpt-oss`), a generation MUST
trazê-lo num item `reasoning` antes da mensagem do assistente, sem mudar o fallback nem o tempo até
o primeiro token, que continuam decididos pelo primeiro texto.

#### Scenario: Modelo que pensa antes de responder

- **WHEN** o modelo devolve raciocínio antes do texto da resposta
- **THEN** a generation mostra o raciocínio antes da resposta, e o primeiro token e o fallback
  continuam contados pelo texto

### Requirement: Units e custo gravados por pergunta

A API MUST gravar `app.questions.langfuse_trace_id` de toda pergunta amostrada e somar as units do
trace (trace e observations) em `usage_daily.langfuse_units`, na linha `global`, no dia da pergunta,
e 1 unit por score. `app.questions.shadow_cost_usd` MUST ser gravado em todas as linhas, com 0
quando nenhum modelo respondeu (recusa, cache, falha ou desconexão).

#### Scenario: Resposta pelo stream

- **WHEN** uma pergunta amostrada é respondida sem fallback
- **THEN** a linha da pergunta tem o `trace_id` e `usage_daily.langfuse_units` sobe 4

#### Scenario: Desconexão no meio do stream

- **WHEN** o cliente desconecta durante a resposta de uma pergunta amostrada
- **THEN** a pergunta fica `aborted` com `shadow_cost_usd = 0`, e o trace sai com o desfecho
  `aborted` e a generation interrompida

### Requirement: Feedback no trace e annotation queue

`POST /api/v1/questions/:id/feedback` MUST continuar gravando no Postgres e, se a pergunta tem trace,
criar em tarefa pós-resposta, com teto, o score `user_feedback` (BOOLEAN, 1 no 👍 e 0 no 👎, motivo no
comentário); o 👎 MUST pôr o trace na annotation queue `teko-feedback-negativo`. Falha do Langfuse
SHALL NOT mudar a resposta da rota.

#### Scenario: Langfuse fora do ar

- **WHEN** o usuário dá 👎 numa pergunta amostrada e o Langfuse responde 503
- **THEN** a rota responde 204 e a falha fica no log da tarefa pós-resposta

### Requirement: Apagamento dos traces com a conta

`DELETE /api/v1/me` MUST pedir, em tarefa pós-resposta, o apagamento no Langfuse de todos os traces
do usuário, achados pelo `userId` em hash.

#### Scenario: Usuário com traces

- **WHEN** um usuário com traces amostrados apaga a conta
- **THEN** os traces dele (com observations e scores) somem do Langfuse

### Requirement: Modelos, feedback e units pelo ops.yml

O job `langfuse` do `ops.yml` (environment `ops`) MUST cadastrar nos projetos `teko-prod` e
`teko-staging`, de forma idempotente, os modelos e preços de `services/pricing.ts`, a score config
`user_feedback` e a annotation queue do 👎, e empurrar `teko_langfuse_units_projected` (os dois
projetos somados) e o próprio sucesso ao Grafana Cloud. Projeto sem chaves SHALL ser pulado com
aviso; falha MUST deixar o job vermelho; com `dry_run`, nada SHALL ser escrito.

#### Scenario: Preço novo na tabela

- **WHEN** `services/pricing.ts` muda o preço de um modelo
- **THEN** o job apaga o modelo antigo no Langfuse e cria o novo com o preço por token

#### Scenario: Environment ops vazio

- **WHEN** nenhuma chave do Langfuse existe no environment `ops`
- **THEN** o job avisa nos dois projetos e termina verde, sem métrica
