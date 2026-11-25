## MODIFIED Requirements

### Requirement: Synthetic Monitoring sem acordar o banco

O Synthetic Monitoring MUST checar o `/healthz` de `https://tekoia.vercel.app` de hora em hora e a
landing de produção a cada 15 min, dentro da cota gratuita, e o `GET /healthz` SHALL responder sem
tocar o banco nem dependência externa. Check que invoca a Function MUST NOT rodar mais de uma vez
por hora (cada execução é um cold start em Active CPU), e o `/healthz` do staging MUST ficar
desligado. Um `503` de qualquer check `teko-*` MUST disparar o alerta de `DEPLOYMENT_PAUSED`.

#### Scenario: Ping de saúde

- **WHEN** a sonda chama `GET /healthz` com o Neon suspenso
- **THEN** a API responde 200 sem abrir conexão com o banco

#### Scenario: Projeto pausado

- **WHEN** a landing ou o `/healthz` de produção recebe 503
- **THEN** o alerta `teko-deployment-paused` dispara com o link de `vercel-paused.md`

#### Scenario: Check que invoca a Function com intervalo curto

- **WHEN** um check ligado de `infra/grafana/synthetic-monitoring.json` aponta para `/healthz` com frequência abaixo de 60 min
- **THEN** `scripts/grafana-apply.ts --validate` falha nomeando o check e as invocações por dia

#### Scenario: Landing de produção antes da F7

- **WHEN** o web de produção ainda não foi publicado e `https://tekoia.vercel.app/pt-BR/` responde 404
- **THEN** o `teko-landing-production` está com `enabled: false`, não executa nem gasta cota, e nenhum alerta dispara por ele

### Requirement: Alerta de check sintético falho

O alerta crítico `teko-synthetic-failed` MUST disparar quando um check `teko-*` não tem nenhuma
execução com sucesso (`probe_success`) em 65 minutos, com o link de
`ops-alerts.md#check-sintetico-falhando`, e SHALL cobrir qualquer falha da sonda (timeout, rede,
TLS, status ou corpo), não só o 503. A janela de cada alerta do Synthetic Monitoring MUST passar da
frequência do check ligado mais lento, e a validação do Grafana as code SHALL reprovar uma janela
menor.

#### Scenario: API caída com timeout

- **WHEN** a execução do `teko-healthz-production` nos últimos 65 min termina em timeout
- **THEN** o alerta `teko-synthetic-failed` dispara para esse check, com o link do runbook

#### Scenario: Uma execução boa na janela

- **WHEN** três execuções do `teko-landing-production` falham com 500 e a quarta, na mesma janela de 65 min, responde 200 com `Tekó`
- **THEN** o alerta `teko-synthetic-failed` não dispara

#### Scenario: Projeto pausado por mais de 20 min

- **WHEN** a landing de produção responde 503 em todas as execuções por 20 min
- **THEN** o `teko-deployment-paused` dispara na primeira execução com 503, e o `teko-synthetic-failed` ainda não dispara (a janela dele é de 65 min)

#### Scenario: Projeto pausado por mais de 65 min

- **WHEN** a landing de produção responde 503 em todas as execuções por 65 min
- **THEN** o `teko-deployment-paused` dispara na primeira execução com 503 e o `teko-synthetic-failed` dispara depois de 65 min, os dois para o mesmo check

#### Scenario: Janela menor que a frequência

- **WHEN** uma regra `source: synthetic` olha `[20m]` e o check ligado mais lento roda de hora em hora
- **THEN** `scripts/grafana-apply.ts --validate` falha nomeando a regra e o check
