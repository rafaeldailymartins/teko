## ADDED Requirements

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

## MODIFIED Requirements

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
