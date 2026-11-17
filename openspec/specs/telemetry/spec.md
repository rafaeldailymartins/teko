# telemetry Specification

## Purpose

Define a telemetria da API do Tekó com OpenTelemetry: o SDK iniciado antes da aplicação, a
exportação OTLP direta ao Grafana Cloud sem timer, a amostragem, os spans das dependências externas,
os logs duráveis correlacionados e o contrato de métricas dos painéis e alertas.

## Requirements

### Requirement: SDK do OpenTelemetry antes da aplicação

A API MUST iniciar o SDK do OpenTelemetry (linha 2.x, sem `@vercel/otel` e sem coletor) em
`server.ts`, antes do `import()` da raiz de composição, com o resource `service.name=teko-api`,
`service.version`, `deployment.environment.name`, `vcs.ref.head.revision`,
`process.runtime.version` e, na Vercel, `cloud.region`.

#### Scenario: Span de uma requisição na Vercel

- **WHEN** a API de staging responde uma requisição de `/api`
- **THEN** o span tem `service.name=teko-api`, `deployment.environment.name=staging` e
  `cloud.region=gru1`

### Requirement: Exportação só com endpoint configurado

Com `OTEL_EXPORTER_OTLP_ENDPOINT`, traces, métricas e logs SHALL ir por OTLP/HTTP direto a esse
endpoint, com os headers de `OTEL_EXPORTER_OTLP_HEADERS`; sem ele, nada MUST ser exportado e as
métricas SHALL ser no-op. Staging e produção MUST exigir endpoint https.

#### Scenario: Sem endpoint no CI

- **WHEN** a API sobe sem `OTEL_EXPORTER_OTLP_ENDPOINT`
- **THEN** nenhuma requisição OTLP sai do processo, e as respostas continuam trazendo `x-trace-id`

#### Scenario: Endpoint em texto claro em produção

- **WHEN** `APP_ENV=production` e `OTEL_EXPORTER_OTLP_ENDPOINT=http://otlp.example`
- **THEN** o boot falha citando `OTEL_EXPORTER_OTLP_ENDPOINT`, sem repetir o valor dos headers

### Requirement: Amostragem sem health check e sem a flag do navegador

Todo span MUST ser amostrado, exceto os de `/healthz` e `/api/healthz`. Com pai remoto (o
`traceparent` recebido), o span SHALL manter o `trace_id` do pai e MUST ignorar a flag `sampled`;
com pai local descartado, os filhos SHALL ser descartados também.

#### Scenario: Navegador sem amostragem

- **WHEN** chega `POST /api/v1/questions` com `traceparent` de flag `00`
- **THEN** o span `request` é gravado e exportado com o `trace_id` desse `traceparent`

#### Scenario: Health check

- **WHEN** o monitor chama `GET /healthz`
- **THEN** nenhum span da requisição é exportado

### Requirement: Flush por requisição sem timer

Ao fim de cada requisição de `/api` (exceto `/api/healthz`), a API MUST agendar em `BackgroundTasks`,
com teto de 500 ms, o `forceFlush` de traces e logs; as métricas SHALL sair no mesmo flush, no máximo
uma vez por minuto por instância, em temporalidade cumulativa por padrão ou delta por configuração. Nenhuma exportação MUST depender de timer, e
uma falha de exportação MUST NOT falhar a requisição nem gerar log. No encerramento gracioso, a API
SHALL exportar o que restou, métricas inclusive.

#### Scenario: Duas perguntas no mesmo minuto

- **WHEN** a mesma instância responde duas requisições de `/api` com 10 s de intervalo
- **THEN** os traces e logs das duas são exportados no fim de cada uma, e as métricas só no fim da
  primeira

### Requirement: Spans das dependências externas

As consultas ao Postgres, as chamadas ao LLM, aos embeddings e ao reranker MUST gerar spans de
cliente filhos do span da requisição, criados nos adapters sem hook de módulo. Os spans MUST NOT
levar os parâmetros das consultas, o conteúdo do prompt nem a mensagem do erro (só `error.type`).

#### Scenario: Pergunta respondida

- **WHEN** uma pergunta passa pela busca e pelo LLM
- **THEN** o trace dela tem os spans `pg <operação>`, `embeddings`, `rerank` e `chat <modelo>`, este
  com `gen_ai.usage.input_tokens` e `gen_ai.usage.output_tokens`

### Requirement: Logs duráveis correlacionados

Cada linha do pino MUST continuar no stdout em JSON e, com a telemetria ligada, SHALL ir também ao
exporter OTLP de logs, depois do `redact`, com `env`, `service`, o nível e, dentro de uma requisição,
o `trace_id` e o `span_id` do span ativo.

#### Scenario: Erro numa requisição

- **WHEN** uma rota falha com 500 e o error handler loga a falha
- **THEN** o log record no Loki tem `level` `error` e o mesmo `trace_id` do trace da requisição

### Requirement: Contrato de métricas

A API MUST emitir as métricas da tabela de `docs/architecture/observabilidade.md` com aqueles nomes
de instrumento e atributos (`http.server.request.duration`, `teko.rag.*`, `teko.llm.*` e
`teko.quota.used_ratio`), definidas num só módulo atrás da porta `Telemetry`; o domínio e a
aplicação MUST NOT importar OpenTelemetry.

#### Scenario: Recusa por falta de evidência

- **WHEN** uma pergunta é recusada como `no_evidence` no stream
- **THEN** `teko.rag.answers` soma 1 com `outcome=refused`, `refusal_reason=no_evidence`, `cached=false`
  e a `corpus_version` da pergunta

#### Scenario: Fallback da cadeia

- **WHEN** o Gemini primário responde 429 e o fallback responde
- **THEN** `teko.llm.provider_errors` soma 1 com `provider=gemini` e `status=429`, e
  `teko.llm.provider_fallback` soma 1 do modelo primário para o que respondeu

#### Scenario: Pergunta respondida pelo LLM

- **WHEN** o stream termina com resposta do `gemini-3.5-flash-lite`
- **THEN** `teko.llm.ttft` e `teko.llm.tokens` (`type=input` e `type=output`) e
  `teko.llm.shadow_cost` recebem os valores da chamada com `provider=gemini` e o modelo

### Requirement: Ponto de extensão dos span processors

O provider de traces MUST aceitar span processors adicionais, no mesmo provider do exporter do
Grafana, para que os spans cheguem a todos com o mesmo `trace_id`; o flush e o encerramento SHALL
alcançá-los. Um processor adicional MAY filtrar o que exporta: o do Langfuse recebe todos os spans e
exporta só as observations do SDK do Langfuse.

#### Scenario: Processor do Langfuse

- **WHEN** as chaves do Langfuse estão configuradas
- **THEN** o `LangfuseSpanProcessor` recebe os mesmos spans do exporter do Grafana, com o mesmo
  `trace_id`, exporta só as observations do Langfuse e o flush por requisição chama o `forceFlush`
  dele
