# Design

## Context

Estado real em 2026-11-18: o environment `ops` tem os segredos do Grafana, do Langfuse e do Neon,
mas ainda não tem `VERCEL_USAGE_TOKEN` nem variáveis da Vercel; o `maintenance` tem as URLs do
`teko_app` dos dois bancos; o banco de produção ainda não tem schema (a primeira migração sai com o
primeiro deploy de produção). Os projetos `tekoia` e `tekoia-staging` ficam no time Hobby, e o
deploy é sempre `--prebuilt` (ADR 0017). Outros agentes escrevem em paralelo o
`scripts/vercel-firewall.ts` (contrato `--env staging|production [--lockdown on|off] [--dry-run]`,
com `VERCEL_TOKEN` e `VERCEL_ORG_ID`).

## Goals / Non-Goals

**Goals:** medir o uso todo dia e agir sozinho em 85% e 95% sem nunca desligar nada sozinho;
exercitar a guarda no staging sem gerar carga; rodar o purge semanal nos dois bancos e registrar o
sucesso; tudo verde enquanto os segredos não existem.

**Non-Goals:** rodar contra os serviços reais nesta mudança; projeção linear do uso (a janela já é
de 30 dias, a mesma da cota); alerta próprio para o kill switch (os de 75% e de job parado cobrem).

## Decisions

- **Uso pelo Vercel CLI, ações pela API REST.** Não há endpoint público documentado de uso; o
  `vercel billing usage --json` (o antigo `vercel usage`, hoje subcomando de `billing` no CLI
  65.11.0) usa o `/v2/billing/costs` interno e entrega
  `{ period, context, costUnit, services: [{ name, product, quantity, unit, cost, included,
  category }], totals }` (lido no `serializeService` do CLI instalado). As ações usam a API REST
  documentada, por `fetch`, testável com fakes: `GET/POST /v10/projects/{id}/env` (`upsert=true`,
  `decrypt=true`), `GET /v13/deployments/{domínio}` (a deployment para onde o domínio canônico
  aponta é a "deployment de produção atual", inclusive depois de `promote` ou `rollback`),
  `POST /v13/deployments?forceNew=1` com `deploymentId` e `target: production` (o mesmo corpo do
  `vercel redeploy`), `GET /v13/deployments/{id}` até `READY` e
  `POST /v10/projects/{id}/promote/{deploymentId}` se o domínio não acompanhar.
- **Parser tolerante e falha visível.** Aceita lixo antes do JSON, `quantity`, `usage` ou `value`, e
  casa o recurso pelo nome ou pelo slug do produto normalizados (`Fluid Provisioned Memory`,
  `fluidProvisionedMemory`). Contagens aceitam qualquer unidade em palavra; tempo, memória e
  transferência só convertem com unidade conhecida (frações exatas). Unidade nova reprova só aquele
  recurso; nenhuma linha reconhecida num relatório não vazio reprova o job; linha sem cota vira
  aviso. Recurso ausente vale 0 (a Vercel omite o que não foi usado).
- **Cotas fixadas no script** (`HOBBY_QUOTAS`), da página "Hobby Plan Included Usage": 360 GB-h de
  memória provisionada, 4 h de Active CPU, 1M invocações, 10 GB de Fast Origin Transfer, 100 GB de
  Fast Data Transfer, 1M CDN Requests, as de imagem e 1M spans (tabela de `contas-e-cotas.md`). A
  razão é uso de 30 dias sobre a cota mensal, conta inteira, sem label de ambiente.
- **Idempotência pelo tempo.** O kill switch está "aplicado" quando a variável vale `true` e a
  deployment de produção atual foi criada depois do `updatedAt` dela. Variável ligada com
  deployment mais velha (redeploy anterior falhou) só redeploya; variável já aplicada não faz nada.
  Um deploy normal depois do kill switch também o enxerga (o env sync não toca na variável).
- **Redeploy sem `meta`.** O corpo não leva `meta`, para a deployment nova herdar o
  `artifactSha256` e o `gitSha` do deploy atestado. Risco: a Vercel avisa que o redeploy de uma
  deployment `--prebuilt` "não usa as env vars mais recentes"; o runbook manda conferir a pergunta
  nova (503 `service_paused`) e, se a variável não pegar, rodar o deploy normal. O exercício do DoD
  no staging confirma o comportamento.
- **Lockdown antes do kill switch em 95%.** O WAF tem efeito imediato; o redeploy espera minutos. O
  lockdown é reaplicado a cada execução acima de 95% (o script do firewall só muda o que difere).
- **Processos filhos com env mínimo.** O CLI e o `vercel-firewall.ts` recebem só `VERCEL_TOKEN`,
  `VERCEL_ORG_ID`, telemetria desligada e o básico do sistema; nunca a credencial OTLP. A saída
  deles vai ao log com `::` neutralizado. Caminhos são constantes (`scripts/lib/cli-guards.ts`).
- **Exercício sem carga.** `--force-threshold 0.85|0.95 --only <env>` age como se o uso tivesse
  chegado ao limiar, sem ler o uso nem enviar métricas; `--release` desliga kill switch e
  lockdown. `--only` só vale nesses modos (a cota é da conta). No `ops.yml`, os inputs
  `kill_switch` e `kill_switch_target`, com `dry_run` (padrão `true`).
- **Cron por `github.event.schedule`.** Um segundo cron (`0 6 * * 0`) e um `if` por job: o diário
  roda grafana, coverage-age, quotas, langfuse e vercel-usage; o semanal, só o weekly-maintenance.
  O input `job` escolhe no dispatch (`all` = os diários); `weekly-maintenance` só roda se escolhido.
- **Purge em `maintenance`, métrica em `ops`.** O OTLP mora no `ops`; o `weekly-maintenance` passa
  `ok` por output (purge sem falha em pelo menos um banco) e o `weekly-maintenance-metrics` chama
  `ops-metrics.ts --job weekly-maintenance --success-only`, como o `quotas` recebe do
  `coverage-age`. Dry-run não purga (a CLI não tem dry-run) e não registra sucesso.
- **Schema ausente na produção.** `maintenance purge --allow-missing-schema` (só na produção) trata
  SQLSTATE `42P01`/`3F000` como aviso, com `{"skipped":"schema_missing"}` e saída 0; permissão e
  qualquer outro erro continuam falha. Reaproveita `isMissingCorpusSchema` do `coverage-mark`.
- **Pausa sem host alternativo.** O `vercel-paused.md` cobre o diagnóstico, o aviso no README e no
  status enquanto a Vercel estiver pausada e a retomada manual (`vercel project resume`, alias
  `unpause`, ou `POST /v1/projects/{id}/unpause`).

## Risks / Trade-offs

- **Formato do `billing usage`.** Não é API pública; o parser tolerante e a falha visível (job
  vermelho, alerta de job parado) cobrem a troca, com a correção descrita no `ops-alerts.md`.
- **Token com escopo do time.** A Vercel não tem token mais estreito que o time; ele lê o uso e
  muda env, deployments e WAF dos dois projetos. Fica só no `ops` (ref `main`), só no `env` do passo
  e com validade de 90 dias.
- **Janela de 30 dias contra cota mensal.** A Vercel não diz se a janela do Hobby é móvel; os 30
  dias são o lado conservador.
- **Religa no dia seguinte.** Se o mantenedor desligar com o uso ainda acima de 85%, a execução
  diária liga de novo; o runbook diz para desligar só abaixo disso.

## Fontes Context7

| Biblioteca / serviço                                                                                | ID                 | Consulta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel (docs)                                                                                       | `/websites/vercel` | `vercel billing usage` (`--since`, `--json`: `period`, `context`, `costUnit`, `services`, `totals`); cotas do Hobby ("Hobby Plan Included Usage"); `POST /v10/projects/{idOrName}/env` com `upsert=true`; `GET /v10/projects/{idOrName}/env` com `decrypt`; `POST /v13/deployments` (`deploymentId`, `target`, `forceNew`); `GET /v13/deployments/{idOrUrl}`; `POST /v10/projects/{projectId}/promote/{deploymentId}`; `vercel redeploy` reaproveita o output de uma deployment `--prebuilt` |
| Conferido também no código do Vercel CLI 65.11.0 instalado em `tools/vercel-cli`: o subcomando é    |
| `billing usage` (o `usageCommand` mora em `billing`), a forma do JSON (`serializeService`), o corpo |
| do `vercel redeploy` (`deploymentId`, `name`, `target`, `forceNew=1`) e o aviso sobre deployments   |
| `--prebuilt`; e que existe `vercel project resume` (alias `unpause`).                               |
