# Proposal

## Why

O único alerta do Synthetic Monitoring é o `teko-deployment-paused`, que só olha o 503 do
`/healthz`. Se a API cair com timeout, erro de rede, TLS ou 500, os checks falham e nada dispara.
Ao mesmo tempo, o check `teko-landing-production` aponta para `https://tekoia.vercel.app/pt-BR/`,
que responde 404 (medido em 2026-11-17) porque o web de produção só sai no deploy da F7: com um
alerta de falha genérico, ele dispararia sem parar e gastaria execuções à toa.

## What Changes

- Alerta novo `teko-synthetic-failed` (grupo `teko-synthetic`, `source: synthetic`, crítico,
  `for: 0s`): um check `teko-*` sem nenhuma execução com sucesso em 20 min, sobre `probe_success`,
  com runbook em `docs/runbooks/ops-alerts.md#check-sintetico-falhando`.
- O check `teko-landing-production` fica com `enabled: false` até o primeiro deploy do web de
  produção (F7). A cota passa a contar só checks ligados: 17.280 execuções/mês hoje, 20.160 com a
  landing ligada.
- A validação exige `enabled` booleano em cada check; o plano e o resumo do apply marcam o check
  desligado.
- Docs: tabela de alertas e de cota do `infra/grafana/README.md`, seção "Alertas por e-mail" e
  Synthetic Monitoring de `observabilidade.md`, `contas-e-cotas.md`, pendência no `docs/status.md`
  e item no DoD da F7 do `docs/roadmap.md`.
- Correção no `infra/grafana/README.md`: as API keys project-scoped do Neon (`NEON_API_KEY_PROD` e
  `NEON_API_KEY_STAGING`) não são "só leitura de uso"; têm papel Editor no projeto, e o texto
  explica por que o risco fica contido.

Fora de escopo: rodar o `grafana-apply` ou o `ops.yml` contra a stack real, mais sondas, e ligar o
check da landing (fica para o deploy do web de produção da F7).

Fase: F6 (observabilidade), complemento do `add-uptime-monitoring`. ADRs afetadas: nenhuma; o
desenho do Grafana as code segue o da arquitetura.

## Capabilities

### New Capabilities

Nenhuma.

### Modified Capabilities

- `operations-monitoring`: alerta de check sintético falho; cota só dos checks ligados; check da
  landing de produção desligado até a F7.

## Impact

- `infra/grafana/alerts.json`, `infra/grafana/synthetic-monitoring.json`, `infra/grafana/README.md`.
- `scripts/lib/grafana-as-code.ts` (`REQUIRED_ALERTS`, `monthlyExecutions`, validação de
  `enabled`), `scripts/grafana-apply.ts` (nota do plano e resumo) e `scripts/grafana-apply.test.ts`.
- `docs/runbooks/ops-alerts.md`, `docs/architecture/observabilidade.md`,
  `docs/architecture/contas-e-cotas.md`, `docs/status.md`, `docs/roadmap.md`.
