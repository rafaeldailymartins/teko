# Design

## Context

A arquitetura de observabilidade (`docs/architecture/observabilidade.md`) fixa o destino (Grafana
Cloud Free: métricas, alertas e Synthetic Monitoring), a lista de dashboards e de alertas e o
`ops.yml` como o lugar das métricas que a API não emite. Três mudanças correm em paralelo na F6:
`add-otel-telemetry` emite as métricas da API pelo contrato combinado (nomes Prometheus como chegam
ao Mimir: `http_server_request_duration_seconds_*`, `teko_rag_*`, `teko_llm_*`,
`teko_quota_used_ratio`, com `service_name` e `deployment_environment_name` promovidos a label),
`add-product-analytics` liga o PostHog e, depois, `add-llm-tracing-langfuse` acrescenta ao
`ops.yml` o cadastro de modelos no Langfuse e a métrica `teko_langfuse_units_projected`. A F7 traz
`vercel-usage`, `weekly-maintenance` e `prod-vuln-scan`. O environment `ops` ainda não existe.

## Goals / Non-Goals

**Goals:**

- Dashboards, alertas, contact point e checks versionados, revisáveis em diff e validados no CI
  sem credencial.
- Apply idempotente só a partir de `main`, com dry-run que só lê.
- Métricas de cota diárias sem acordar o compute do Neon, e o `/healthz` monitorado sem CU-h.
- `ops.yml` verde com o environment vazio e fácil de estender.

**Non-Goals:**

- Os jobs da F7 (`vercel-usage`, `weekly-maintenance`, `prod-vuln-scan`) e o job de modelos do
  Langfuse: só o contrato das métricas deles e as regras que as usam.
- Instrumentar a API (mudança `add-otel-telemetry`).
- Criar contas, environments ou segredos, ou aplicar contra a stack real.

## Decisions

- **API HTTP do Grafana, sem CLI.** O Terraform precisaria de estado (sem backend gratuito, o estado
  iria para artifact ou para o repositório). O Grizzly está marcado para descontinuação em favor do
  `grafanactl`, que não gerencia checks do Synthetic Monitoring. A API HTTP é idempotente por UID
  (`POST /api/dashboards/db` com `overwrite`, `PUT .../rule-groups/{group}`, contact point por UID,
  checks por `job`), cabe num script Node sem dependência e é testável com `fetch` falso. Os
  endpoints `/api/v1/provisioning/*` estão "deprecated" em favor do App Platform, mas documentados;
  a troca fica restrita ao `scripts/grafana-apply.ts`.
- **Formato compacto.** Um painel é título, tipo, unidade, PromQL e limiares; uma regra é PromQL,
  operador, limiar, `for`, severidade, runbook e fonte. O script monta `gridPos`, datasource pela
  variável `$datasource`, a consulta `A` instantânea e o `threshold` `B`. O diff fica legível e a
  validação offline é simples; exportar da UI para cá exige reescrever no formato (aceitável com
  cinco dashboards).
- **Validação offline como gate.** `--validate` confere UIDs, nomes de métrica contra
  `KNOWN_METRICS` (o contrato), variáveis, parênteses, o conjunto exato de alertas da arquitetura
  (`REQUIRED_ALERTS`), runbook existente com âncora explícita (`<a id>`, porque o slug do GitHub de
  título com acento não é ASCII) ou previsto na tabela da arquitetura (F7), nenhum e-mail nos JSON e
  a cota do Synthetic Monitoring (teto de 50% das 100 mil execuções do Free). Roda pelos testes dos
  scripts, no job `lint` do CI; não mexe no `ci-gate` nem no `pr-gate`.
- **Roteamento simplificado.** Cada regra traz `notification_settings.receiver = teko-email`; o
  apply não sobrescreve a árvore de notification policies da stack. Os e-mails vêm do segredo
  `GRAFANA_ALERT_EMAILS`; sem ele e sem o contact point já criado, os grupos de regras são pulados
  (o `PUT` falharia com receiver inexistente).
- **`noDataState: OK` em todas as regras.** Sem tráfego, sem a fonte (F7, Langfuse) ou antes do
  primeiro envio, nada dispara. Falha de um job diário aparece pela idade de
  `teko_ops_job_last_success_timestamp_seconds`, não pela ausência da série.
- **Métricas diárias com `last_over_time(...[2d])`.** Um gauge empurrado uma vez por dia some das
  consultas instantâneas 5 min depois (lookback do Prometheus).
- **OTLP/HTTP JSON sem SDK, gauges sem `unit`.** O Grafana Cloud acrescenta sufixo de unidade
  (`_ratio` para gauge com unit `1`); sem `unit`, o nome chega exato. `service.name=teko-ops` e
  `deployment.environment.name` no resource (os dois promovidos a label por padrão); `project`,
  `family`, `token` e `ops_job` como atributos do ponto (`ops_job`, e não `job`, que é o label do
  serviço).
- **CU-h do Neon pela API do console.** `GET /projects/{id}` traz `compute_time_seconds` (CU-s do
  período) e `consumption_period_start`/`_end`, sem acordar o compute.
  `teko_neon_cu_hours_ratio = usado / fração decorrida / 100`, com piso de um dia na fração para o
  primeiro dia do ciclo.
- **Idade da cobertura pela CLI, com o `teko_watch`.** `cli coverage-age` (porta
  `CoverageVerifiedReader`, um `SELECT family, verified_at`) roda num job com o environment
  `corpus-watch`, que já tem as URLs, e passa o JSON por output ao `quotas` (environment `ops`): as
  URLs de banco nunca entram no `ops`, e o `quotas` nunca abre a porta 5432. O cron das 09:40 UTC
  fica logo depois do `source-watch` (09:00) para pegar o compute ainda acordado; no pior caso, uma
  ativação de 5 min a 0,25 CU por dia por projeto (cerca de 0,6 CU-h/mês). Alternativa descartada:
  ler no próprio `mark-coverage`, o que exigiria a credencial OTLP no `corpus-watch` ou artifact
  entre workflows.
- **Checks do Synthetic Monitoring.** `/healthz` dos dois projetos a cada 5 min e a landing
  (`/pt-BR/`) a cada 15 min, uma sonda (`SaoPaulo`): 20.160 execuções/mês. O domínio de produção dos
  dois projetos é público (Standard Protection), então nenhum check carrega o bypass. O alerta de
  `DEPLOYMENT_PAUSED` é o `probe_http_status_code == 503` no `/healthz`, que na Vercel só responde
  503 com o projeto pausado.
- **`/healthz` sem banco, provado na app inteira.** O teste de integração sobe `buildApp` com
  `DATABASE_URL` e um `application_name` único e confere no `pg_stat_activity` que nenhuma sessão
  foi aberta depois de três checks (DoD "não incrementa CU-h em 24 h").
- **`ops.yml` extensível.** Cada job: harden-runner em `block` com os hosts do serviço, checkout sem
  credenciais, `setup-node` (sem instalar o workspace quando o script só usa a biblioteca padrão),
  passo de conferência que avisa e pula sem o segredo. O cabeçalho do workflow explica como o job de
  modelos do Langfuse entra; o `ci-config.test.sh` confere as invariantes em todos os jobs.

## Risks / Trade-offs

- **Contrato antes da fonte.** Os painéis e alertas da API e da F7 só mostram dados quando as outras
  mudanças entrarem; um nome divergente apareceria como painel vazio. Mitigação: o contrato está em
  `KNOWN_METRICS` e foi combinado com `add-otel-telemetry`.
- **Temporalidade delta.** A API exporta métricas em delta; as consultas usam `rate`/`increase` sobre
  contadores Prometheus, como o contrato pede. Se o Mimir guardar algum contador como gauge, as
  consultas daquele painel mudam, não o resto.
- **API de provisionamento "deprecated".** Ainda documentada no Grafana Cloud; a migração para o App
  Platform fica no script.
- **Sonda única.** Uma queda da sonda de São Paulo vira falso negativo de disponibilidade (nenhum
  alerta de indisponibilidade foi pedido, só o de 503); mais sondas multiplicam as execuções.

## Context7

| Biblioteca / serviço     | ID                                  | Consulta                                                                                                                                                                                                                                   |
| ------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Grafana (HTTP API)       | `/websites/grafana`                 | `PUT /api/v1/provisioning/folder/{uid}/rule-groups/{group}`, `X-Disable-Provenance`, contact points, `notification_settings`, `POST /api/dashboards/db`, pastas                                                                            |
| Grafana Cloud            | `/websites/grafana_grafana-cloud`   | API do Synthetic Monitoring (access token, backend por região), cobrança por execução (`sondas × checks × duração × 43.200 / frequência`), opções comuns dos checks, OTLP: atributos promovidos, sufixos de unidade, endpoint e Basic auth |
| Synthetic Monitoring App | `/grafana/synthetic-monitoring-app` | métodos HTTP aceitos; a especificação OpenAPI da API (`/api/v1/check`, `/api/v1/check/{id}`, `/api/v1/probe`, frequência e timeout em ms) foi lida em `synthetic-monitoring-api.grafana.net/api/v1/openapi`                                |
| Grizzly                  | `/grafana-cold-storage/grizzly`     | aviso de descontinuação em favor do `grafanactl`; recursos suportados                                                                                                                                                                      |
| Neon                     | `/neondatabase/website`             | `GET /projects/{id}`: `compute_time_seconds`, `consumption_period_start`, uso no Free sem acordar o compute                                                                                                                                |
| GitHub Actions           | `/websites/github_en_actions`       | segredo vazio em `env` e `if`, `paths` com `branches`, segredos de environment em job                                                                                                                                                      |
| Harden-Runner            | `/step-security/harden-runner`      | `egress-policy: block` com `allowed-endpoints` e curinga de subdomínio                                                                                                                                                                     |
