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
`teko_neon_compute_hours`, `teko_neon_cu_hours_ratio` e `teko_neon_data_transfer_ratio` (pela API
do Neon, sem acordar o compute), `teko_token_expiry_days`, `teko_coverage_verified_age_days` e
`teko_ops_job_last_success_timestamp_seconds`. Fonte não configurada SHALL ser pulada com aviso;
fonte configurada que falha MUST deixar o job vermelho depois de enviar o resto.

#### Scenario: Projeção de CU-h

- **WHEN** o projeto consumiu 30 CU-h e passaram 40% do período de cobrança
- **THEN** `teko_neon_compute_hours` vale 30 e `teko_neon_cu_hours_ratio` vale 0,75

#### Scenario: Transferência do período

- **WHEN** o Neon informa `data_transfer_bytes` de 4.000.000.000 no período
- **THEN** `teko_neon_data_transfer_ratio` vale 0,8 para o projeto (sobre os 5 GB do Free, sem projeção), qualquer que seja a fração decorrida do período

#### Scenario: Neon sem data_transfer_bytes

- **WHEN** a resposta do `GET /projects/{id}` não traz `data_transfer_bytes`
- **THEN** o job envia as outras métricas e termina vermelho, sem contar a transferência como zero

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

### Requirement: Medição do uso da Vercel

O job `vercel-usage` do `ops.yml` MUST ler uma vez por dia o uso dos últimos 30 dias da conta
Vercel Hobby, compará-lo com as cotas do Hobby fixadas em `scripts/vercel-usage.ts` e empurrar
`teko_vercel_usage_ratio{resource}` e o próprio sucesso. Sem `VERCEL_USAGE_TOKEN`, o job SHALL
avisar e terminar verde.

#### Scenario: Uso abaixo de 85%

- **WHEN** o recurso mais usado está em 22% da cota
- **THEN** o job envia as razões e o sucesso e não muda env var, deployment nem WAF

#### Scenario: Formato do relatório mudou

- **WHEN** a saída do `vercel billing usage` traz linhas e nenhuma casa com as cotas, ou um recurso conhecido vem numa unidade desconhecida
- **THEN** o job termina vermelho sem registrar sucesso, e os outros recursos ainda são avaliados

#### Scenario: Environment ops sem o token

- **WHEN** `VERCEL_USAGE_TOKEN` não existe no environment `ops`
- **THEN** o job avisa no resumo e termina verde, sem ler nem mudar nada

### Requirement: Kill switch e lockdown automáticos

Com uso em 85% ou mais de qualquer recurso, o `vercel-usage` SHALL gravar `LLM_KILL_SWITCH=true`
nos dois projetos e redeployar a deployment de produção atual de cada um; com 95% ou mais, SHALL
também ligar o lockdown da regra 1 do WAF. O job MUST NOT desligar nada por conta própria e MUST
NOT redeployar quando o kill switch já estiver aplicado.

#### Scenario: Memória provisionada em 85%

- **WHEN** a memória provisionada dos últimos 30 dias chega a 306 de 360 GB-h
- **THEN** `LLM_KILL_SWITCH=true` é gravado nos dois projetos e a deployment de produção atual de cada um é redeployada

#### Scenario: Kill switch já aplicado

- **WHEN** o uso continua acima de 85% e a variável já vale `true` numa deployment criada depois dela
- **THEN** o job não grava nem redeploya de novo

#### Scenario: Uso em 95%

- **WHEN** qualquer recurso chega a 95% da cota
- **THEN** o job chama `vercel-firewall.ts --lockdown on` nos dois projetos, além do kill switch

### Requirement: Exercício e volta manual da guarda

O dispatch do `ops.yml` MUST permitir exercitar a guarda num único projeto como se o uso tivesse
chegado a 85% ou 95%, sem ler o uso nem enviar métricas, e SHALL oferecer a volta manual, que
desliga o kill switch (com redeploy) e o lockdown. Com `dry_run`, nada é escrito: o job só mostra o
plano.

#### Scenario: Exercício do kill switch no staging

- **WHEN** o mantenedor dispara `job: vercel-usage`, `kill_switch: 0.85`, `kill_switch_target: staging` e `dry_run: false`
- **THEN** só o `tekoia-staging` recebe `LLM_KILL_SWITCH=true` e um redeploy, e nenhuma métrica é enviada

#### Scenario: Volta manual

- **WHEN** o mantenedor dispara `kill_switch: release` para um projeto com o kill switch ligado
- **THEN** a variável vira `false`, a deployment de produção é redeployada e o lockdown é desligado

### Requirement: Manutenção semanal

O job `weekly-maintenance` MUST rodar `cli maintenance purge` (role `teko_app`, environment
`maintenance`) no staging e na produção todo domingo às 06:00 UTC, e o sucesso SHALL ser registrado
em `teko_ops_job_last_success_timestamp_seconds{ops_job="weekly-maintenance"}` por um job seguinte
no environment `ops`, só quando o purge rodou sem falha. Banco sem schema MUST ser aviso, não falha,
quando o purge recebe `--allow-missing-schema`; qualquer outro erro continua falha.

#### Scenario: Produção antes da primeira migração

- **WHEN** o purge roda com `--allow-missing-schema` num banco sem as tabelas de `app` e `auth`
- **THEN** a CLI imprime `{"skipped":"schema_missing"}`, avisa e termina com 0

#### Scenario: Purge do staging pelo dispatch

- **WHEN** o mantenedor dispara `job: weekly-maintenance`, `maintenance_target: staging` e `dry_run: false`
- **THEN** só o banco do staging é expurgado e o sucesso do job é registrado

#### Scenario: Dry-run

- **WHEN** o dispatch do `weekly-maintenance` usa `dry_run: true`
- **THEN** nenhum banco é tocado e nenhum sucesso é registrado

### Requirement: Alertas de transferência do Neon

O Grafana as code MUST ter os alertas `teko-neon-transfer-50` (aviso) e `teko-neon-transfer-80`
(crítico) sobre `teko_neon_data_transfer_ratio` por projeto e ambiente, com o runbook
`neon-suspended.md#transferencia-acima-da-cota`, e o dashboard de cotas SHALL mostrar a razão por
projeto.

#### Scenario: Staging com 4,1 GB no período

- **WHEN** `teko_neon_data_transfer_ratio{project="teko-staging"}` vale 0,82
- **THEN** os dois alertas disparam com o link do runbook
