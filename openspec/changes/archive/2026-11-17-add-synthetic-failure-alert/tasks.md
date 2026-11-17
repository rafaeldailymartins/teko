# Tasks

## 1. Grafana as code

- [x] 1.1 Regra `teko-synthetic-failed` em `infra/grafana/alerts.json` e no `REQUIRED_ALERTS`
  (verificar: `node scripts/grafana-apply.ts --validate` sem erros)
- [x] 1.2 `teko-landing-production` com `enabled: false` e o motivo no `$comment` de
  `infra/grafana/synthetic-monitoring.json` (verificar: teste "checks: /healthz dos dois projetos
  e a landing de produção, dentro da cota")
- [x] 1.3 `monthlyExecutions` conta 0 para check desligado, validação exige `enabled` booleano, plano
  e resumo do apply marcam o desligado; testes de 17.280 execuções, do check desligado, do alerta e
  do corpo enviado com `enabled: false` (verificar: `node --test scripts/grafana-apply.test.ts`)

## 2. Docs

- [x] 2.1 Runbook com a âncora `check-sintetico-falhando` em `docs/runbooks/ops-alerts.md` (o que
  olhar; API, Vercel ou sonda; quando o `teko-deployment-paused` vem junto) (verificar: a validação
  confere arquivo e âncora)
- [x] 2.2 Tabelas de cota e de alertas (17) do `infra/grafana/README.md`; "Alertas por e-mail" e
  Synthetic Monitoring de `docs/architecture/observabilidade.md`; `contas-e-cotas.md` (verificar:
  leitura do diff)
- [x] 2.3 Pendência da F7 em `docs/status.md` e item no DoD da F7 em `docs/roadmap.md` (verificar:
  leitura do diff)
- [x] 2.4 Item 8 do `infra/grafana/README.md`: chave project-scoped do Neon com papel Editor, sem
  chave só de leitura, e os três motivos que contêm o risco (verificar: nenhum outro doc diz "só
  leitura" das chaves do Neon, `grep -rn "leitura de uso" docs infra` vazio)

## 3. Gates

- [x] 3.1 `pnpm verify` e `pnpm spec:validate` verdes; mudança arquivada com
  `pnpm exec openspec archive add-synthetic-failure-alert --yes`
