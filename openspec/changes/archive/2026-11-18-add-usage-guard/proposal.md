# Proposal

## Why

A F7 coloca o Tekó no ar na Vercel Hobby, que não compra uso extra: estourar qualquer cota pausa
os dois projetos por cerca de 30 dias (503 `DEPLOYMENT_PAUSED`), e a retomada é manual. A
arquitetura já prevê a guarda (`contas-e-cotas.md`, "Guard rails"), os alertas de 50% e 75% e o de
job parado estão no Grafana as code desde a F6, mas nenhum job mede o uso nem liga o kill switch.
A manutenção semanal (`PurgeExpiredData`) existe na CLI desde a F4 e nunca roda. Faltam também os
runbooks de pausa e de kill switch que a F7 entrega.

## What Changes

- `scripts/vercel-usage.ts` (+ testes no `test:scripts`): lê `vercel billing usage --since 30d
  --json` (Vercel CLI isolado de `tools/vercel-cli`), compara com as cotas do Hobby fixadas no
  script e empurra `teko_vercel_usage_ratio{resource}` e o sucesso do job por OTLP. Em 85% liga
  `LLM_KILL_SWITCH=true` nos dois projetos e redeploya a deployment de produção atual; em 95%
  também chama `scripts/vercel-firewall.ts --lockdown on`. Nunca desliga sozinho; idempotente;
  `--dry-run`; exercício manual (`--force-threshold 0.85|0.95 --only <env>`) e volta (`--release`).
- `ops.yml`: jobs `vercel-usage` (cron diário, environment `ops`, segredo `VERCEL_USAGE_TOKEN` só no
  passo, sem ele avisa e fica verde), `weekly-maintenance` (cron de domingo 06:00 UTC, environment
  `maintenance`, `cli maintenance purge` no staging e na produção) e `weekly-maintenance-metrics`
  (environment `ops`, registra o sucesso recebido por output). Cada job escolhe o cron pelo
  `github.event.schedule`; o dispatch ganha `job`, `maintenance_target`, `kill_switch` e
  `kill_switch_target`.
- CLI da API: `maintenance purge --allow-missing-schema` trata banco sem schema (produção antes da
  primeira migração) como aviso.
- `scripts/ops-metrics.ts --success-only` e um helper `publishPoints` em
  `scripts/lib/otlp-metrics.ts`, compartilhado com o `vercel-usage`.
- `ci-config.test.sh` cobre os jobs novos.
- Runbooks `budget-kill-switch.md` (com o registro do exercício no staging) e `vercel-paused.md`
  (diagnóstico, o que fazer enquanto a Vercel estiver pausada e a retomada manual); atualizações em
  `observabilidade.md`, `contas-e-cotas.md`, `backend.md`, `infra/grafana/README.md` e nos
  runbooks que citavam o `budget-kill-switch.md` como "F7".

Fora de escopo: executar qualquer job contra Vercel ou Neon (o exercício do kill switch e o purge
comprovado no staging são do DoD da F7, com os segredos que o mantenedor cria); o
`vercel-firewall.ts` (mudança `add-vercel-deployment`), que este job só chama pelo contrato.

Fase: F7. ADRs afetadas: nenhuma; segue `contas-e-cotas.md` e `backend.md`.

## Capabilities

### New Capabilities

Nenhuma.

### Modified Capabilities

- `operations-monitoring`: medição do uso da Vercel, kill switch e lockdown automáticos com
  exercício e volta manual, e manutenção semanal.

## Impact

- `scripts/vercel-usage.ts`, `scripts/vercel-usage.test.ts`, `scripts/ops-metrics.ts`,
  `scripts/ops-metrics.test.ts`, `scripts/lib/otlp-metrics.ts`, `scripts/grafana-apply.test.ts`.
- `apps/api/src/cli.ts`, `apps/api/src/adapters/in/cli/maintenance/`.
- `.github/workflows/ops.yml`, `.github/scripts/ci-config.test.sh`.
- `docs/runbooks/budget-kill-switch.md`, `docs/runbooks/vercel-paused.md`,
  `docs/runbooks/ops-alerts.md`, `docs/runbooks/provider-outage.md`,
  `docs/runbooks/quota-exhausted.md`, `docs/architecture/{observabilidade,contas-e-cotas,backend}.md`,
  `infra/grafana/README.md`, `infra/grafana/dashboards/vercel-hobby.json`.
- Segredo e variável novos (criados pelo mantenedor): `VERCEL_USAGE_TOKEN` e `VERCEL_ORG_ID` em
  `ops`.
