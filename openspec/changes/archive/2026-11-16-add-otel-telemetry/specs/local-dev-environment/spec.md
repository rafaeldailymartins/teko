## ADDED Requirements

### Requirement: Observabilidade local opcional

O profile `otel` MUST subir o `grafana/otel-lgtm` (Grafana, Tempo, Loki, Mimir e coletor OTel num
contêiner), com a imagem fixada por digest e as portas publicadas só em `127.0.0.1`: o Grafana em
`3300` e o OTLP/HTTP em `4318`. A API local SHALL exportar para ele quando
`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`.

#### Scenario: Profile ativado

- **WHEN** o desenvolvedor sobe a stack com `--profile otel` e a API com
  `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`
- **THEN** uma requisição a `/api` aparece como trace no Tempo do Grafana em `http://localhost:3300`,
  com os logs dela no Loki
