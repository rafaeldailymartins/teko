# Tasks

## 1. Guarda de uso

- [x] 1.1 `scripts/vercel-usage.ts`: leitura pelo `vercel metrics` em janelas de até 27 minutos,
  estado por dia em `.vercel-usage/state.json`, estimativa de 30 dias pela cobertura, falha da fonte
  sem sucesso e sem avançar o estado (verificar: `node --test scripts/vercel-usage.test.ts`)
- [x] 1.2 Testes com o simulador do `vercel metrics`: janela, parser, estado, extrapolação,
  `payment_required`, formato novo, dry-run e estado ilegível

## 2. Workflow e alertas

- [x] 2.1 `ops.yml`: cron de 10 min só para o `vercel-usage`, grupos de concorrência, cache do
  estado (verificar: actionlint e `bash .github/scripts/ci-config.test.sh`)
- [x] 2.2 `alerts.json`: `teko-ops-job-stale` com 6 h e ausência de 10 dias; `teko-deployment-paused`
  com 402 (verificar: `node scripts/grafana-apply.ts --validate`)

## 3. Docs

- [x] 3.1 Runbooks `vercel-paused.md`, `budget-kill-switch.md` e `ops-alerts.md`
- [x] 3.2 `contas-e-cotas.md`, `observabilidade.md`, `infra/grafana/README.md` e `docs/status.md`
