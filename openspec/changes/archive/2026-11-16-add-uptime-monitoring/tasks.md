# Tasks

## 1. Grafana as code

- [x] 1.1 `infra/grafana/` no formato compacto: `stack.json`, cinco dashboards (API RED, LLM, cotas, Vercel Hobby, sinais de RAG por ambiente e `corpus_version`), `alerts.json` com os alertas da arquitetura e `synthetic-monitoring.json`
- [x] 1.2 `scripts/lib/grafana-as-code.ts`: leitura, validação offline (contrato de métricas, alertas obrigatórios, runbook com âncora, e-mail, cota do SM) e expansão para a API — `scripts/grafana-apply.test.ts`
- [x] 1.3 `scripts/grafana-apply.ts`: `--validate`, `--dry-run` (só GET) e apply (pasta, contact point, dashboards, grupos de regras, checks; remove checks `teko-*` que saíram) — `scripts/grafana-apply.test.ts` com Grafana e SM falsos
- [x] 1.4 `infra/grafana/README.md`: escolha da ferramenta, validação, dry-run, apply, conta da cota e o que o mantenedor cria

## 2. Métricas de cota

- [x] 2.1 `scripts/lib/otlp-metrics.ts` (gauges OTLP/HTTP JSON sem `unit`) e `scripts/ops-metrics.ts` (Neon, tokens, idade da cobertura, sucesso do job; pula sem configuração, falha com fonte quebrada) — `scripts/ops-metrics.test.ts`
- [x] 2.2 `cli coverage-age` (porta `CoverageVerifiedReader`, `createPgCoverageVerifiedReader`, `runCoverageAge`) — `run-coverage-age.test.ts` e `test/integration/watch/coverage-watch.test.ts`
- [x] 2.3 `/healthz` sem sessão no Postgres com a app inteira — `test/integration/http/foundation.test.ts`

## 3. Workflow

- [x] 3.1 `.github/workflows/ops.yml`: cron diário, push de `infra/grafana/`, dispatch com `dry_run`; jobs `grafana` (ops, só `main`), `coverage-age` (corpus-watch) e `quotas` (ops), harden-runner em `block`, pins por SHA, `permissions: {}` — actionlint 1.7.12
- [x] 3.2 Invariantes do `ops.yml` no `.github/scripts/ci-config.test.sh` e `ops.yml` na exceção `self-repository` do zizmor

## 4. Documentação

- [x] 4.1 Runbooks `provider-outage.md`, `quota-exhausted.md`, `neon-suspended.md`, `quotas.md` e `ops-alerts.md`
- [x] 4.2 `docs/architecture/observabilidade.md` (Grafana as code, métricas do `ops.yml`, situação dos runbooks) e `contas-e-cotas.md` (nomes das métricas do Neon, cota do Grafana Cloud)
