# Proposal

## Why

Em 2026-11-25 a Vercel desativou os dois projetos (`402 Payment Required`, `X-Vercel-Error:
DEPLOYMENT_DISABLED`, inclusive no estático): a conta Hobby passou de 100% de Fluid Active CPU (4 h).
A guarda de uso deveria ter ligado o kill switch em 85% e o lockdown em 95%, mas nunca mediu nada:
o `vercel billing usage --since 30d --json` que ela lia responde 404 `costs_not_found` no Hobby
("Billing cost data is unavailable [...] the team has no active subscription"), e todos os runs
agendados do `vercel-usage` desde 2026-11-19 ficaram vermelhos. O alerta `teko-ops-job-stale` não
disparou porque a série de sucesso do job nunca existiu (em 2026-11-18 o job rodou sem o token e
não enviou nada; depois só falhou): sem amostra, a regra fica em NoData, que é `Normal`. E o alerta
`teko-deployment-paused` só olha 503, não o 402 desta pausa.

## What Changes

- **Fonte nova de uso, a única que responde no Hobby:** `vercel metrics` (Vercel CLI isolado de
  `tools/vercel-cli`), que no Hobby aceita as métricas `vercel.function_invocation.*` da conta
  inteira (`--all`) só para janelas que comecem há no máximo 30 minutos. O `vercel-usage` passa a
  rodar a cada 10 minutos, lê a janela ainda não contada (até 27 min para trás, 5 min de atraso de
  ingestão) de CPU ativa, GB-h de duração (limite superior da memória provisionada), invocações e
  Fast Origin Transfer, e soma por dia num estado (`.vercel-usage/state.json`) guardado no cache do
  Actions. O uso de 30 dias é a soma dos dias, extrapolada pela cobertura (lacunas de cron atrasado
  ou de falha preenchidas pela média lida). Fast Data Transfer, CDN Requests, spans e imagens não
  têm fonte no Hobby (`payment_required` em qualquer janela) e ficam fora da guarda, ditos no
  resumo e nos runbooks.
- **Falha visível no mesmo dia:** fonte que não responde deixa o job vermelho, sem registrar sucesso
  e sem avançar o estado; o `teko-ops-job-stale` passa a disparar com 6 h sem sucesso do
  `vercel-usage` (era 30 h) e também quando não há nenhum sucesso em 10 dias (`absent_over_time`).
- **402 é pausa:** o `teko-deployment-paused` dispara com 503 (`DEPLOYMENT_PAUSED`) ou 402
  (`DEPLOYMENT_DISABLED`) no `/healthz`.
- `ops.yml`: cron `3-59/10 * * * *` só para o `vercel-usage` (fora do diário), grupo de
  concorrência próprio para esse cron (para não cancelar o diário pendente), concorrência do job
  `vercel-usage` e os passos de `actions/cache/restore` e `actions/cache/save` (sem dry-run).
  `ci-config.test.sh` cobre os três crons, o grupo e o estado no cache.
- Runbooks `vercel-paused.md` (402, registro de 2026-11-25), `budget-kill-switch.md` (fonte nova e
  grau de confiança), `ops-alerts.md` (6 h); `contas-e-cotas.md`, `observabilidade.md`,
  `infra/grafana/README.md` e `docs/status.md`.

Fora de escopo: retomar os projetos (manual, depois que a Vercel liberar) e o consumo de CPU em si
(cold start da API, outra frente).

Fase: pós-F7 (incidente). ADRs afetadas: nenhuma; o estado fica no cache do Actions, não no GitHub
Releases da ADR 0030, porque os jobs do `ops.yml` não têm escrita no repositório.

## Capabilities

### New Capabilities

Nenhuma.

### Modified Capabilities

- `operations-monitoring`: medição do uso da Vercel (fonte, frequência, estado e falha), kill switch
  sobre o uso estimado dos recursos medidos e alerta de pausa com 402.

## Impact

- `scripts/vercel-usage.ts`, `scripts/vercel-usage.test.ts`, `scripts/lib/grafana-as-code.ts`.
- `.github/workflows/ops.yml`, `.github/scripts/ci-config.test.sh`, `.gitignore`.
- `infra/grafana/alerts.json`, `infra/grafana/README.md`.
- `docs/runbooks/{vercel-paused,budget-kill-switch,ops-alerts}.md`,
  `docs/architecture/{contas-e-cotas,observabilidade}.md`, `docs/status.md`.
