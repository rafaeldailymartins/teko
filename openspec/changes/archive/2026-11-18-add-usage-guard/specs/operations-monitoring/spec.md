## ADDED Requirements

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
