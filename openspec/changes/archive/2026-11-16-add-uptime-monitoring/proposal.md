# Proposal

## Why

A F6 precisa enxergar a produção e as cotas antes da F7 publicar o Tekó de verdade. Hoje não há
painel, alerta nem monitor externo: um 5xx, um provedor de LLM devolvendo 429, o Neon passando da
meta de CU-h ou o `verified_at` parado só aparecem quando alguém olha à mão. A arquitetura
(`docs/architecture/observabilidade.md`) define Grafana as code em `infra/grafana/`, Synthetic
Monitoring no lugar do UptimeRobot e do Checkly, alertas por e-mail com runbook e o `ops.yml` com
as métricas de cota que a API não emite. É a mudança `add-uptime-monitoring` da F6.

## What Changes

- `infra/grafana/` versionado: pasta, contact point de e-mail (endereços por segredo), cinco
  dashboards (API RED, LLM, cotas, Vercel Hobby e sinais de RAG por ambiente e `corpus_version`),
  as regras de alerta da seção "Alertas por e-mail" da arquitetura, cada uma com o link do runbook,
  e três checks do Synthetic Monitoring (`/healthz` de produção e do staging e a landing de
  produção), num formato compacto que o script expande para a API do Grafana.
- `scripts/grafana-apply.ts`: validação offline (`--validate`, roda no CI pelos testes dos
  scripts), `--dry-run` com leitura do estado real e o apply pela API HTTP do Grafana e do
  Synthetic Monitoring, sem CLI de terceiros.
- `scripts/ops-metrics.ts`: o job de cotas lê o consumo dos projetos Neon pela API (sem acordar o
  compute), as datas de expiração dos tokens e a idade do `verified_at` por família e empurra
  `teko_neon_compute_hours`, `teko_neon_cu_hours_ratio`, `teko_token_expiry_days`,
  `teko_coverage_verified_age_days` e `teko_ops_job_last_success_timestamp_seconds` por OTLP/HTTP
  ao Grafana Cloud.
- CLI da API: `coverage-age`, leitura de `corpus.coverage` com o role `teko_watch` (porta
  `CoverageWatchRepository.listVerifiedAt`).
- `.github/workflows/ops.yml`: cron diário e `workflow_dispatch` com dry-run; jobs `grafana`
  (environment `ops`, só em `main`), `coverage-age` (environment `corpus-watch`) e `quotas`
  (environment `ops`), com harden-runner em `block`. Cada job pula com aviso quando o segredo ainda
  não existe.
- Runbooks `provider-outage.md`, `quota-exhausted.md`, `neon-suspended.md`, `quotas.md` e
  `ops-jobs.md` em `docs/runbooks/`; tabela de runbooks e nomes das métricas atualizados na
  arquitetura.
- Fora de escopo (F7/F8): os jobs `vercel-usage`, `weekly-maintenance` e `prod-vuln-scan`. Os
  painéis e alertas já referenciam as métricas deles (`teko_vercel_usage_ratio`,
  `teko_prod_vuln_findings`, `teko_ops_job_last_success_timestamp_seconds`), documentadas como
  contrato. `teko_langfuse_units_projected` vem da mudança `add-llm-tracing-langfuse`.

## Capabilities

### New Capabilities

- `operations-monitoring`: dashboards, alertas e checks sintéticos como código, e as métricas de
  cota empurradas pelo `ops.yml`.

### Modified Capabilities

- Nenhuma.

## Impact

- Nenhuma dependência nova: os dois scripts usam só a biblioteca padrão do Node 24.
- Environment `ops` (o mantenedor cria) com o SA token e o token do Synthetic Monitoring, a
  credencial OTLP de escrita de métricas, as API keys do Neon e as variáveis da stack; o job
  `coverage-age` reaproveita as URLs do `teko_watch` do environment `corpus-watch`.
- Uma leitura diária a mais em cada projeto Neon (o `coverage-age`), logo depois do
  `source-watch`, com o compute em geral ainda acordado; no pior caso, cerca de 0,6 CU-h por mês
  por projeto.
