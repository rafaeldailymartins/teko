# operations-monitoring Specification

## Purpose

Define como o Tekó observa a produção e as cotas: dashboards, alertas e checks sintéticos do
Grafana Cloud versionados em `infra/grafana/`, aplicados pelo `ops.yml`, e as métricas de cota que
o job diário empurra por OTLP.

## Requirements

### Requirement: Grafana as code validado offline

Dashboards, regras de alerta, contact point, pasta e checks do Synthetic Monitoring MUST viver em
`infra/grafana/` como JSON versionado, e `scripts/grafana-apply.ts --validate` SHALL validá-los sem
rede nem credencial (UIDs, métricas do contrato, runbook de cada alerta, nenhum e-mail e a cota do
Synthetic Monitoring), no CI de todo PR com código. A cota MUST contar só os checks ligados: check
com `enabled: false` não roda e conta 0 execução.

#### Scenario: Alerta sem runbook

- **WHEN** uma regra de `infra/grafana/alerts/` não traz `runbook` ou aponta para um arquivo fora de `docs/runbooks/`
- **THEN** a validação falha nomeando a regra

#### Scenario: Checks acima da cota gratuita

- **WHEN** a soma de execuções mensais dos checks ligados (sondas × 43.200 / frequência em minutos) passa de 50% das 100 mil do Free
- **THEN** a validação falha com a conta

#### Scenario: Check desligado fora da conta

- **WHEN** um check tem `enabled: false`
- **THEN** ele conta 0 execução na validação e no resumo do apply, e o apply o cria ou atualiza desligado

### Requirement: Apply só pelo tronco, com dry-run

O job `grafana` do `.github/workflows/ops.yml` MUST rodar só em `refs/heads/main`, no environment
`ops`, e SHALL aplicar o Grafana as code pela API HTTP do Grafana e do Synthetic Monitoring no cron
diário, no push que muda `infra/grafana/` e no `workflow_dispatch`; com `dry-run`, o job MUST só
ler o estado real e imprimir o plano, sem escrever.

#### Scenario: Dispatch em dry-run

- **WHEN** o mantenedor dispara o `ops.yml` com `dry-run: true`
- **THEN** o job lista o que criaria ou atualizaria e nenhum recurso do Grafana muda

#### Scenario: Environment ops ainda vazio

- **WHEN** o `GRAFANA_SA_TOKEN` não existe no environment `ops`
- **THEN** o job valida os arquivos, avisa no resumo que o apply foi pulado e termina verde

### Requirement: Alertas por e-mail com runbook

As regras MUST cobrir os alertas da seção "Alertas por e-mail" de
`docs/architecture/observabilidade.md`, cada uma com a anotação `runbook_url`, e SHALL notificar o
contact point `teko-email`, cujos endereços vêm do segredo `GRAFANA_ALERT_EMAILS` no apply. Regras
cuja fonte ainda não existe (F7) MUST ficar definidas com `noDataState: OK`.

#### Scenario: Taxa de 5xx

- **WHEN** mais de 2% das requisições da API num ambiente terminam em 5xx numa janela de 10 min
- **THEN** o alerta `teko-api-5xx` dispara com o link de `docs/runbooks/provider-outage.md`

#### Scenario: Fonte da F7 ausente

- **WHEN** `teko_vercel_usage_ratio` ainda não existe no Mimir
- **THEN** os alertas de uso da Vercel ficam em `Normal`, sem e-mail

### Requirement: Synthetic Monitoring sem acordar o banco

O Synthetic Monitoring MUST checar `/healthz` de `https://tekoia.vercel.app` e de
`https://tekoia-staging.vercel.app` e a landing de produção dentro da cota gratuita, e o
`GET /healthz` SHALL responder sem tocar o banco nem dependência externa, para que o check não
incremente CU-h. Um `503` visto por um check de `/healthz` MUST disparar o alerta de
`DEPLOYMENT_PAUSED`. O check da landing MUST ficar desligado até o deploy do web da F7.

#### Scenario: Ping de saúde

- **WHEN** a sonda chama `GET /healthz` com o Neon suspenso
- **THEN** a API responde 200 sem abrir conexão com o banco

#### Scenario: Projeto pausado

- **WHEN** o check de `/healthz` de produção recebe 503
- **THEN** o alerta `teko-deployment-paused` dispara com o link de `vercel-paused.md`

#### Scenario: Landing de produção antes da F7

- **WHEN** o web de produção ainda não foi publicado e `https://tekoia.vercel.app/pt-BR/` responde 404
- **THEN** o `teko-landing-production` está com `enabled: false`, não executa nem gasta cota, e nenhum alerta dispara por ele

### Requirement: Métricas de cota do ops.yml

O job `quotas` MUST empurrar por OTLP/HTTP ao Grafana Cloud, uma vez por dia,
`teko_neon_compute_hours` e `teko_neon_cu_hours_ratio` (pela API do Neon, sem acordar o compute),
`teko_token_expiry_days`, `teko_coverage_verified_age_days` e
`teko_ops_job_last_success_timestamp_seconds`. Fonte não configurada SHALL ser pulada com aviso;
fonte configurada que falha MUST deixar o job vermelho depois de enviar o resto.

#### Scenario: Projeção de CU-h

- **WHEN** o projeto consumiu 30 CU-h e passaram 40% do período de cobrança
- **THEN** `teko_neon_compute_hours` vale 30 e `teko_neon_cu_hours_ratio` vale 0,75

#### Scenario: Credencial OTLP ausente

- **WHEN** `GRAFANA_OTLP_TOKEN` não existe
- **THEN** o job imprime as métricas calculadas, avisa que não enviou e termina verde

### Requirement: Idade do verified_at pela CLI

A CLI da API MUST oferecer `coverage-age`, que lê `family` e `verified_at` de `corpus.coverage` nos
dois bancos com o role `teko_watch` e imprime um JSON de uma linha; banco sem o schema `corpus`
SHALL aparecer sem famílias e com aviso, sem reprovar o comando.

#### Scenario: Produção ainda sem corpus

- **WHEN** o `teko-prod` ainda não tem o schema `corpus`
- **THEN** a saída traz `teko-prod` com `families: []` e o comando termina com 0

### Requirement: Alerta de check sintético falho

O alerta crítico `teko-synthetic-failed` MUST disparar quando um check `teko-*` não tem nenhuma
execução com sucesso (`probe_success`) em 20 minutos, com o link de
`ops-alerts.md#check-sintetico-falhando`, e SHALL cobrir qualquer falha da sonda (timeout, rede,
TLS, status ou corpo), não só o 503.

#### Scenario: API caída com timeout

- **WHEN** as quatro execuções do `teko-healthz-production` nos últimos 20 min terminam em timeout
- **THEN** o alerta `teko-synthetic-failed` dispara para esse check, com o link do runbook

#### Scenario: Uma execução boa na janela

- **WHEN** três execuções do `teko-healthz-staging` falham com 500 e a quarta, na mesma janela de 20 min, responde 200 com `"status":"ok"`
- **THEN** o alerta `teko-synthetic-failed` não dispara

#### Scenario: Projeto pausado por mais de 20 min

- **WHEN** o `/healthz` de produção responde 503 em todas as execuções por 20 min
- **THEN** o `teko-deployment-paused` dispara na primeira execução com 503 e o `teko-synthetic-failed` dispara depois de 20 min, os dois para o mesmo check
