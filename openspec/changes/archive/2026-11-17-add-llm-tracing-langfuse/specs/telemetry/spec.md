## MODIFIED Requirements

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
