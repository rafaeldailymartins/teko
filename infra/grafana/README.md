# Grafana Cloud as code

Dashboards, alertas por e-mail, contact point e checks do Synthetic Monitoring da stack Grafana
Cloud Free do Tekó (F6, mudança OpenSpec `add-uptime-monitoring`;
[observabilidade](../../docs/architecture/observabilidade.md#grafana-cloud-as-code-em-infragrafana)).
Os arquivos são um formato compacto em JSON, validado offline e expandido por
`scripts/grafana-apply.ts` para a API HTTP do Grafana e do Synthetic Monitoring. Não há CLI de
terceiros nem estado guardado: cada recurso tem UID (ou `job`) fixo e é criado ou sobrescrito.

| Arquivo                     | Conteúdo                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `stack.json`                | pasta `teko-ops`, contact point `teko-email`, base dos links de runbook e UID do datasource    |
| `dashboards/*.json`         | API RED, LLM, cotas, Vercel Hobby e sinais de RAG (painéis com título, tipo, unidade e PromQL) |
| `alerts.json`               | grupos e regras: PromQL, limiar, `for`, severidade, runbook e de onde vem a métrica            |
| `synthetic-monitoring.json` | checks HTTP (corpo do `POST /api/v1/check`, com as sondas por nome)                            |

## Por que a API HTTP e não Terraform ou Grizzly

- **Terraform** (provider `grafana/grafana`) cobre tudo, mas precisa de estado: sem backend pago,
  o estado ficaria em artifact ou no repositório, e um apply sem ele tentaria recriar tudo.
- **Grizzly** (`grr`) está marcado para descontinuação em favor do `grafanactl`
  (Context7 `/grafana-cold-storage/grizzly`), que não gerencia checks do Synthetic Monitoring.
- **A API HTTP** é idempotente por UID, não precisa de estado nem de binário fixado, roda com o
  Node do runner e é testável com `fetch` falso. Os endpoints de provisionamento de alertas
  (`/api/v1/provisioning/*`) estão marcados como "deprecated" em favor das APIs do App Platform,
  mas continuam documentados; trocar é mudar o `scripts/grafana-apply.ts`, não os arquivos daqui.

## Validar e testar

```bash
node scripts/grafana-apply.ts --validate
```

Sem rede nem credencial. Confere UIDs únicos (`teko-*`), nomes de métrica contra o contrato
(`KNOWN_METRICS` em `scripts/lib/grafana-as-code.ts`), variáveis declaradas, parênteses e aspas
das consultas, o conjunto exato de alertas da arquitetura (`REQUIRED_ALERTS`), o `runbook` de cada
alerta (arquivo de `docs/runbooks/` com a âncora `<a id="...">`, ou previsto na tabela de runbooks
da arquitetura), nenhum e-mail nos arquivos e a cota do Synthetic Monitoring. O teste
`scripts/grafana-apply.test.ts` roda a mesma validação nos arquivos reais, a expansão e o apply
contra um Grafana falso; ele entra no `pnpm test:scripts`, que o job `lint` do CI roda em todo PR
com código.

**Dry-run contra a stack real:** Actions → Ops → Run workflow com `dry_run` marcado (o padrão). O
job `grafana` só faz GET e escreve o plano no resumo (create, update, keep, skip ou delete por
recurso). Localmente, com as mesmas variáveis no ambiente: `node scripts/grafana-apply.ts
--dry-run`.

## Aplicar

O job `grafana` do `.github/workflows/ops.yml` (environment `ops`, só em `main`) aplica no cron
diário (corrige drift feito na UI), no push para `main` que muda `infra/grafana/` e no dispatch sem
`dry_run`. Ordem: pasta, contact point, dashboards, grupos de regras, checks. O que sai dos
arquivos **não** é apagado, exceto checks com `job` `teko-*` (contam execuções da cota); regra
removida de um grupo some no `PUT` do grupo, mas um grupo inteiro removido fica na stack até ser
apagado à mão.

## Synthetic Monitoring e a cota

| Check                     | Alvo                                        | Frequência | Sondas     | Execuções/mês |
| ------------------------- | ------------------------------------------- | ---------- | ---------- | ------------- |
| `teko-healthz-production` | `https://tekoia.vercel.app/healthz`         | 5 min      | `SaoPaulo` | 8.640         |
| `teko-healthz-staging`    | `https://tekoia-staging.vercel.app/healthz` | 5 min      | `SaoPaulo` | 8.640         |
| `teko-landing-production` | `https://tekoia.vercel.app/pt-BR/`          | 15 min     | `SaoPaulo` | 2.880         |
| **total**                 |                                             |            |            | **20.160**    |

Conta do Grafana (`sondas × checks × duração em minutos × 43.200 / frequência`): cada check HTTP
dura menos de 1 min, então `1 × 43.200 / 5 = 8.640` e `43.200 / 15 = 2.880`. O Free inclui 100 mil
execuções de API test por mês; a validação reprova acima de 50 mil, para sobrar espaço. Os checks
usam `basicMetricsOnly` (menos séries ativas dos 10 mil do Free).

- **`/healthz` não toca o banco** (`apps/api/src/application/use-cases/get-health.ts` e
  `routes/health.ts`: só o estado do processo, sem rate limit, que usa o Postgres). O teste de
  integração "GET /healthz sem banco" (`apps/api/test/integration/http/foundation.test.ts`) sobe a
  app inteira com `DATABASE_URL` e confere que nenhuma sessão é aberta; por isso o check não acorda
  o Neon nem gasta CU-h. As 17.280 invocações por mês dos dois `/healthz` estão na premissa de
  "pings de 5 min" das cotas da Vercel; a landing é estática (CDN, sem Function).
- **Deployment Protection:** o domínio de produção dos dois projetos Vercel é público (Standard
  Protection, `infra/vercel/README.md`), inclusive o `tekoia-staging.vercel.app`; os checks não
  precisam do bypass de automação, que continua só no smoke contra a URL única.
- **503 no `/healthz`** = `DEPLOYMENT_PAUSED` (a drenagem por SIGTERM só existe fora da Vercel):
  alerta `teko-deployment-paused`.

## Alertas

Todos notificam o contact point `teko-email` (rótulos `severity`, `source` e `teko`), com
`noDataState: OK`: sem tráfego ou sem a fonte da métrica, a regra fica em Normal. Os links de
runbook apontam para `main` no GitHub.

| UID                        | Condição                                                             | Fonte                            | Runbook                                   |
| -------------------------- | -------------------------------------------------------------------- | -------------------------------- | ----------------------------------------- |
| `teko-api-5xx`             | 5xx > 2% em 10 min                                                   | API                              | `provider-outage.md#5xx-na-api`           |
| `teko-api-questions-p95`   | p95 de `POST /api/v1/questions` > 3 s                                | API                              | `provider-outage.md#latencia`             |
| `teko-llm-ttft-p95`        | TTFT p95 > 3 s                                                       | API                              | `provider-outage.md#latencia`             |
| `teko-llm-429`             | 429 > 20% das tentativas em 15 min, por provedor                     | API                              | `quota-exhausted.md#429-por-provedor`     |
| `teko-quota-used`          | `teko_quota_used_ratio` > 0,7                                        | API                              | `quota-exhausted.md#cotas-da-aplicacao`   |
| `teko-rag-refusal-anomaly` | recusa em 1 h > 2× a de 7 dias, > 25% e ≥ 20 respostas               | API                              | `ops-alerts.md#recusa-...`                |
| `teko-rag-lexical-only`    | `lexical_only` > 10% em 30 min, ≥ 5 respostas                        | API                              | `provider-outage.md#embeddings`           |
| `teko-deployment-paused`   | `/healthz` respondeu 503 ao Synthetic Monitoring                     | Synthetic Monitoring             | `vercel-paused.md` (F7)                   |
| `teko-neon-cu-hours`       | `teko_neon_cu_hours_ratio` > 0,7                                     | `ops.yml` (`quotas`)             | `neon-suspended.md#cu-h-...`              |
| `teko-langfuse-units`      | `teko_langfuse_units_projected` > 35.000                             | `ops.yml` (Langfuse)             | `quota-exhausted.md#langfuse`             |
| `teko-vercel-usage-50`     | `teko_vercel_usage_ratio` > 0,5                                      | `ops.yml` (`vercel-usage`, F7)   | `budget-kill-switch.md` (F7)              |
| `teko-vercel-usage-75`     | `teko_vercel_usage_ratio` > 0,75                                     | `ops.yml` (`vercel-usage`, F7)   | `budget-kill-switch.md` (F7)              |
| `teko-coverage-stale`      | `teko_coverage_verified_age_days` > 3                                | `ops.yml` (`coverage-age`)       | `ops-alerts.md#cobertura-sem-verificacao` |
| `teko-prod-vuln-scan`      | `teko_prod_vuln_findings{severity=~"high\|critical"}` > 0            | `ops.yml` (`prod-vuln-scan`, F7) | `ops-alerts.md#prod-vuln-scan`            |
| `teko-token-expiry`        | `teko_token_expiry_days` < 30                                        | `ops.yml` (`quotas`)             | `secret-rotation.md` (F7)                 |
| `teko-ops-job-stale`       | `vercel-usage` sem sucesso há 30 h ou `weekly-maintenance` há 8 dias | `ops.yml` (F7)                   | `ops-alerts.md#job-sem-sucesso`           |

**Contrato para as fontes que chegam depois** (o validador só aceita estes nomes): a mudança
`add-llm-tracing-langfuse` emite `teko_langfuse_units_projected` (gauge, sem labels); a F7 emite
`teko_vercel_usage_ratio{resource}`, `teko_prod_vuln_findings{severity}` e
`teko_ops_job_last_success_timestamp_seconds{ops_job="vercel-usage"|"weekly-maintenance"}`, todos
pelo `scripts/lib/otlp-metrics.ts` (gauges sem `unit`, `service.name=teko-ops`). Métrica empurrada
uma vez por dia some do Mimir 5 min depois do envio; por isso os painéis e alertas usam
`last_over_time(...[2d])`.

## O que o mantenedor cria

Nada disso passa pelo chat nem pelo repositório: `gh secret set NOME --env ops` (segredos) e
`gh variable set NOME --env ops` (variáveis).

1. **Conta Grafana Cloud Free** (sem cartão) e uma stack na região mais próxima de `gru1` (a
   AWS São Paulo, se disponível no Free). Anote a URL da stack (`https://<stack>.grafana.net`).
2. **Environment `ops`** no GitHub (Settings → Environments), com a regra de branch só `main` e
   sem revisor. O primeiro run agendado do `ops.yml` cria o environment vazio se ele não existir;
   a regra de branch precisa ser posta à mão.
3. **Service account** na stack (Administration → Users and access → Service accounts), papel
   **Editor** (dashboards, pastas e alertas), com um token com expiração: segredo
   `GRAFANA_SA_TOKEN`, e a data em `TOKEN_EXPIRY_DATES`.
4. **Synthetic Monitoring:** Testing & synthetics → Synthetics → inicialize o app, depois
   Configuration → Access tokens → Generate: segredo `GRAFANA_SM_TOKEN`. A URL da API da região
   (Configuration mostra o backend, como `https://synthetic-monitoring-api-sa-east-1.grafana.net`):
   variável `GRAFANA_SM_URL`.
5. **OTLP para as métricas do `ops.yml`:** na página da stack, card OpenTelemetry: endpoint (com
   `/otlp`) na variável `GRAFANA_OTLP_ENDPOINT` e o Instance ID na variável
   `GRAFANA_OTLP_INSTANCE_ID`; gere um access policy token só com `metrics:write`: segredo
   `GRAFANA_OTLP_TOKEN` (separado do token OTLP da Vercel, que também escreve traces e logs).
6. **E-mails dos alertas:** segredo `GRAFANA_ALERT_EMAILS` (um ou mais, separados por `;`).
7. **Variável `GRAFANA_URL`** com a URL da stack. Opcional: `GRAFANA_PROM_DATASOURCE_UID`, se o
   datasource Prometheus da stack não for `grafanacloud-prom` (Connections → Data sources).
8. **Neon:** variáveis `NEON_PROD_PROJECT_ID` e `NEON_STAGING_PROJECT_ID` e segredos
   `NEON_API_KEY_PROD` e `NEON_API_KEY_STAGING` (API keys **project-scoped**, só leitura de uso;
   podem ser as mesmas dos environments `release-rehearsal` e `staging` ou novas).
9. **Tokens com validade:** variável `TOKEN_EXPIRY_DATES` em JSON, nome → data de expiração
   (`{"VERCEL_TOKEN (staging)": "2027-02-14", "VERCEL_TOKEN (production)": "2027-02-14",
   "VERCEL_USAGE_TOKEN": "2027-02-14", "GRAFANA_SA_TOKEN": "2027-11-16"}`). Atualize a cada
   rotação.
10. O job `coverage-age` usa o environment `corpus-watch` que já existe (`NEON_PROD_WATCH_URL` e
    `NEON_STAGING_WATCH_URL`); nada a criar.

Depois, rode o `ops.yml` com `dry_run` e confira o plano; em seguida sem `dry_run`.
