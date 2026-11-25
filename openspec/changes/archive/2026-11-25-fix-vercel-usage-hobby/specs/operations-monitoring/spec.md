## MODIFIED Requirements

### Requirement: Synthetic Monitoring sem acordar o banco

O Synthetic Monitoring MUST checar `/healthz` de `https://tekoia.vercel.app` e de
`https://tekoia-staging.vercel.app` e a landing de produção dentro da cota gratuita, e o
`GET /healthz` SHALL responder sem tocar o banco nem dependência externa, para que o check não
incremente CU-h. Um `503` (`DEPLOYMENT_PAUSED`) ou um `402` (`DEPLOYMENT_DISABLED`) visto por um
check de `/healthz` MUST disparar o alerta de projeto pausado. O check da landing MUST ficar
desligado até o deploy do web da F7.

#### Scenario: Ping de saúde

- **WHEN** a sonda chama `GET /healthz` com o Neon suspenso
- **THEN** a API responde 200 sem abrir conexão com o banco

#### Scenario: Projeto pausado

- **WHEN** o check de `/healthz` de produção recebe 503
- **THEN** o alerta `teko-deployment-paused` dispara com o link de `vercel-paused.md`

#### Scenario: Conta Hobby desativada pela Vercel

- **WHEN** o check de `/healthz` de produção recebe 402 com `X-Vercel-Error: DEPLOYMENT_DISABLED`
- **THEN** o alerta `teko-deployment-paused` dispara com o link de `vercel-paused.md`

#### Scenario: Landing de produção antes da F7

- **WHEN** o web de produção ainda não foi publicado e `https://tekoia.vercel.app/pt-BR/` responde 404
- **THEN** o `teko-landing-production` está com `enabled: false`, não executa nem gasta cota, e nenhum alerta dispara por ele

### Requirement: Medição do uso da Vercel

O job `vercel-usage` do `ops.yml` MUST rodar a cada 10 minutos e ler com o `vercel metrics` a
janela ainda não contada (até 27 minutos) da CPU ativa, da memória provisionada, das invocações
e do Fast Origin Transfer das funções da conta. O job SHALL somar as
janelas num estado no cache do Actions, estimar os 30 dias extrapolando as lacunas pela cobertura e
empurrar `teko_vercel_usage_ratio{resource}` e o próprio sucesso. Sem `VERCEL_USAGE_TOKEN`, o job
SHALL avisar e terminar verde.

#### Scenario: Uso abaixo de 85%

- **WHEN** o recurso mais usado está em 22% da cota na estimativa de 30 dias
- **THEN** o job grava o estado, envia as razões e o sucesso e não muda env var, deployment nem WAF

#### Scenario: Formato do relatório mudou

- **WHEN** o `vercel metrics` devolve um resumo sem a coluna esperada ou uma saída que não é JSON
- **THEN** o job termina vermelho sem registrar sucesso e sem gravar o estado, em vez de contar uso zero

#### Scenario: Lacuna na leitura

- **WHEN** o cron atrasa e só metade dos minutos acompanhados foi lida
- **THEN** o uso estimado é o dobro do lido, e o resumo mostra a cobertura de 50%

#### Scenario: Recurso sem fonte no Hobby

- **WHEN** o job monta o resumo
- **THEN** Fast Data Transfer, CDN Requests, spans e imagens aparecem como "sem fonte no Hobby", sem razão enviada e fora dos limiares

#### Scenario: Environment ops sem o token

- **WHEN** `VERCEL_USAGE_TOKEN` não existe no environment `ops`
- **THEN** o job avisa no resumo e termina verde, sem ler nem mudar nada

### Requirement: Kill switch e lockdown automáticos

Com o uso estimado de 30 dias em 85% ou mais de qualquer recurso medido, o `vercel-usage` SHALL
gravar `LLM_KILL_SWITCH=true` nos dois projetos e redeployar a deployment de produção atual de cada
um; com 95% ou mais, SHALL também ligar o lockdown da regra 1 do WAF. O job MUST NOT desligar nada
por conta própria e MUST NOT redeployar quando o kill switch já estiver aplicado.

#### Scenario: Memória provisionada em 85%

- **WHEN** a memória provisionada estimada dos últimos 30 dias chega a 306 de 360 GB-h
- **THEN** `LLM_KILL_SWITCH=true` é gravado nos dois projetos e a deployment de produção atual de cada um é redeployada

#### Scenario: Kill switch já aplicado

- **WHEN** o uso continua acima de 85% e a variável já vale `true` numa deployment criada depois dela
- **THEN** o job não grava nem redeploya de novo

#### Scenario: Uso em 95%

- **WHEN** qualquer recurso medido chega a 95% da cota
- **THEN** o job chama `vercel-firewall.ts --lockdown on` nos dois projetos, além do kill switch

## ADDED Requirements

### Requirement: Falha visível da guarda de uso

Fonte de uso que não responde MUST deixar o `vercel-usage` vermelho, sem registrar sucesso, sem
avançar o estado e sem agir nos projetos. O alerta `teko-ops-job-stale` MUST disparar com 6 h sem
sucesso do `vercel-usage` ou com nenhum sucesso dele em 10 dias.

#### Scenario: Fonte de uso recusada

- **WHEN** o `vercel metrics` responde `payment_required` ou sai com erro
- **THEN** o job termina vermelho sem registrar sucesso, não grava o estado e não age nos projetos

#### Scenario: Seis horas sem sucesso

- **WHEN** o último sucesso do `vercel-usage` tem mais de 6 h
- **THEN** o `teko-ops-job-stale` dispara com o link de `ops-alerts.md#job-sem-sucesso`

#### Scenario: Guarda que nunca registrou sucesso

- **WHEN** não há nenhuma amostra de `teko_ops_job_last_success_timestamp_seconds{ops_job="vercel-usage"}` nos últimos 10 dias
- **THEN** o `teko-ops-job-stale` dispara, em vez de ficar em `Normal` por falta de dado
