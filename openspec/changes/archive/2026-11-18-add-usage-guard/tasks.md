# Tasks

## 1. Guarda de uso da Vercel

- [x] 1.1 `scripts/vercel-usage.ts`: parser tolerante do `vercel billing usage --json`, cotas do
  Hobby, razões, limiares de 85% e 95%, kill switch com redeploy idempotente, lockdown pelo
  `vercel-firewall.ts`, `--dry-run`, `--force-threshold`, `--only` e `--release` (verificar:
  `node --test scripts/vercel-usage.test.ts`)
- [x] 1.2 `publishPoints` em `scripts/lib/otlp-metrics.ts`, compartilhado com o `ops-metrics.ts`, e
  `ops-metrics.ts --success-only` (verificar: `node --test scripts/ops-metrics.test.ts`)

## 2. Manutenção semanal

- [x] 2.1 `cli maintenance purge --allow-missing-schema` (`adapters/in/cli/maintenance/purge.ts`)
  (verificar: `vitest run --project unit src/adapters/in/cli/maintenance`)

## 3. Workflows

- [x] 3.1 `ops.yml`: cron semanal, `if` por `github.event.schedule`, inputs do dispatch, jobs
  `vercel-usage`, `weekly-maintenance` e `weekly-maintenance-metrics` (verificar: actionlint e
  `bash .github/scripts/ci-config.test.sh`)
- [x] 3.2 Invariantes novas no `ci-config.test.sh` (segredos por job, hosts do egress, crons
  disjuntos, inputs, nenhum `secrets.` em `run`)

## 4. Docs

- [x] 4.1 Runbooks `budget-kill-switch.md` (com o registro do exercício) e `vercel-paused.md` (com o
  registro das pausas) e os links nos runbooks que os citavam como F7; teste do índice de runbooks
  do `grafana-apply` (verificar: `node scripts/grafana-apply.ts --validate`)
- [x] 4.2 `observabilidade.md`, `contas-e-cotas.md`, `backend.md`, `infra/grafana/README.md` e o
  painel `vercel-hobby.json` (verificar: leitura do diff)

## 5. Gates

- [x] 5.1 `pnpm verify:full` verde; mudança arquivada com
  `pnpm exec openspec archive add-usage-guard --yes`
