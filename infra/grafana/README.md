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

| Check                     | Alvo                                        | Frequência | Sondas     | Ligado | Execuções/mês |
| ------------------------- | ------------------------------------------- | ---------- | ---------- | ------ | ------------- |
| `teko-healthz-production` | `https://tekoia.vercel.app/healthz`         | 60 min     | `SaoPaulo` | sim    | 720           |
| `teko-healthz-staging`    | `https://tekoia-staging.vercel.app/healthz` | 60 min     | `SaoPaulo` | não    | 0             |
| `teko-landing-production` | `https://tekoia.vercel.app/pt-BR/`          | 15 min     | `SaoPaulo` | sim    | 2.880         |
| **total**                 |                                             |            |            |        | **3.600**     |

Conta do Grafana (`sondas × checks × duração em minutos × 43.200 / frequência`): cada check HTTP
dura menos de 1 min, então `1 × 43.200 / 60 = 720` e `43.200 / 15 = 2.880`. O Synthetic
Monitoring cobra cada execução feita; check com `enabled: false` não roda e conta 0, na validação e
no resumo do apply. O Free inclui 100 mil execuções de API test por mês; a validação reprova acima
de 50 mil, para sobrar espaço. Os checks usam `basicMetricsOnly` (menos séries ativas dos 10 mil do
Free), que mantém `probe_success`, `probe_http_status_code` e `probe_duration_seconds`.

**Frequência e Active CPU da Vercel:** cada execução de `/healthz` invoca a Function, e com uma
hora entre uma e outra a instância já esfriou: cada uma paga um cold start inteiro em "Fluid Active
CPU", cuja cota do Hobby é de 4 h por mês. Com os dois `/healthz` a cada 5 min (576 invocações por
dia), a conta foi desativada em 2026-11-25 sem usuários reais (mudança `reduce-api-cold-start`, com
a conta em `design.md`). Por isso o `/healthz` de produção roda de hora em hora, só para provar
que a Function sobe e responde, e o de staging fica desligado: o smoke de cada deploy o confere, e a
pausa por cota é da conta inteira, que a produção já mostra. A disponibilidade da borda (e o 503 de
pausa, que vale também para o estático) vem da landing, a cada 15 min, que não invoca a Function.
Antes de encurtar um intervalo ou ligar um check que invoca a Function, refaça a conta com o
`scripts/measure-cold-start.ts`.

**`teko-landing-production`:** ficou desligado até o primeiro deploy do web de produção, porque
antes disso `https://tekoia.vercel.app/pt-BR/` respondia 404 e o check só falharia. Foi ligado em
2026-11-18, depois do deploy do `v0.1.0-rc.3` (`/pt-BR/` com 200).

- **`/healthz` não toca o banco** (`apps/api/src/application/use-cases/get-health.ts` e
  `routes/health.ts`: só o estado do processo, sem rate limit, que usa o Postgres). O teste de
  integração "GET /healthz sem banco" (`apps/api/test/integration/http/foundation.test.ts`) sobe a
  app inteira com `DATABASE_URL` e confere que nenhuma sessão é aberta; por isso o check não acorda
  o Neon nem gasta CU-h. As 720 invocações por mês do `/healthz` de produção estão na premissa de
  "pings de hora em hora" das cotas da Vercel; a landing é estática (CDN, sem Function).
- **Deployment Protection:** o domínio de produção dos dois projetos Vercel é público (Standard
  Protection, `infra/vercel/README.md`), inclusive o `tekoia-staging.vercel.app`; os checks não
  precisam do bypass de automação, que continua só no smoke contra a URL única.
- **503 em qualquer check** = `DEPLOYMENT_PAUSED` (a drenagem por SIGTERM só existe fora da
  Vercel, e a pausa vale para a deployment inteira, estático inclusive); **402** =
  `DEPLOYMENT_DISABLED` (conta Hobby acima da cota, como em 2026-11-25): alerta
  `teko-deployment-paused`. A landing costuma vê-los primeiro (15 min).
- **Qualquer outra falha** (timeout, erro de rede, TLS, 500, corpo sem o texto esperado) em todas
  as execuções de 65 min de um check: alerta `teko-synthetic-failed`, sobre `probe_success`. Os
  dois disparam juntos num 503 que dura mais de 65 min. A janela de 65 min dos dois alertas passa da
  frequência do check ligado mais lento (o `/healthz` de produção, 60 min), para a série nunca ficar
  sem amostra entre duas execuções; a validação reprova janela menor.

## Alertas

Todos notificam o contact point `teko-email` (rótulos `severity`, `source` e `teko`), com
`noDataState: OK`: sem tráfego ou sem a fonte da métrica, a regra fica em Normal. Os links de
runbook apontam para `main` no GitHub.

| UID                        | Condição                                                                                   | Fonte                            | Runbook                                   |
| -------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------- | ----------------------------------------- |
| `teko-api-5xx`             | 5xx > 2% em 10 min                                                                         | API                              | `provider-outage.md#5xx-na-api`           |
| `teko-api-questions-p95`   | p95 de `POST /api/v1/questions` > 3 s                                                      | API                              | `provider-outage.md#latencia`             |
| `teko-llm-ttft-p95`        | TTFT p95 > 3 s                                                                             | API                              | `provider-outage.md#latencia`             |
| `teko-llm-429`             | 429 > 20% das tentativas em 15 min, por provedor                                           | API                              | `quota-exhausted.md#429-por-provedor`     |
| `teko-quota-used`          | `teko_quota_used_ratio` > 0,7                                                              | API                              | `quota-exhausted.md#cotas-da-aplicacao`   |
| `teko-rag-refusal-anomaly` | recusa em 1 h > 2× a de 7 dias, > 25% e ≥ 20 respostas                                     | API                              | `ops-alerts.md#recusa-...`                |
| `teko-rag-lexical-only`    | `lexical_only` > 10% em 30 min, ≥ 5 respostas                                              | API                              | `provider-outage.md#embeddings`           |
| `teko-deployment-paused`   | um check `teko-*` respondeu 503 ou 402 nos últimos 65 min                                  | Synthetic Monitoring             | `vercel-paused.md`                        |
| `teko-synthetic-failed`    | check `teko-*` sem nenhum sucesso em 65 min (`probe_success` < 1)                          | Synthetic Monitoring             | `ops-alerts.md#check-sintetico-...`       |
| `teko-neon-cu-hours`       | `teko_neon_cu_hours_ratio` > 0,7                                                           | `ops.yml` (`quotas`)             | `neon-suspended.md#cu-h-...`              |
| `teko-neon-transfer-50`    | `teko_neon_data_transfer_ratio` > 0,5                                                      | `ops.yml` (`quotas`)             | `neon-suspended.md#transferencia-...`     |
| `teko-neon-transfer-80`    | `teko_neon_data_transfer_ratio` > 0,8 (crítico)                                            | `ops.yml` (`quotas`)             | `neon-suspended.md#transferencia-...`     |
| `teko-langfuse-units`      | `teko_langfuse_units_projected` > 35.000                                                   | `ops.yml` (Langfuse)             | `quota-exhausted.md#langfuse`             |
| `teko-vercel-usage-50`     | `teko_vercel_usage_ratio` > 0,5                                                            | `ops.yml` (`vercel-usage`)       | `budget-kill-switch.md`                   |
| `teko-vercel-usage-75`     | `teko_vercel_usage_ratio` > 0,75                                                           | `ops.yml` (`vercel-usage`)       | `budget-kill-switch.md`                   |
| `teko-coverage-stale`      | `teko_coverage_verified_age_days` > 3                                                      | `ops.yml` (`coverage-age`)       | `ops-alerts.md#cobertura-sem-verificacao` |
| `teko-prod-vuln-scan`      | `teko_prod_vuln_findings{severity=~"high\|critical"}` > 0                                  | `ops.yml` (`prod-vuln-scan`, F7) | `ops-alerts.md#prod-vuln-scan`            |
| `teko-token-expiry`        | `teko_token_expiry_days` < 30                                                              | `ops.yml` (`quotas`)             | `secret-rotation.md` (F7)                 |
| `teko-ops-job-stale`       | `vercel-usage` sem sucesso há 6 h (ou nenhum em 10 dias) ou `weekly-maintenance` há 8 dias | `ops.yml`                        | `ops-alerts.md#job-sem-sucesso`           |

**Contrato para as fontes que chegam depois** (o validador só aceita estes nomes): a mudança
`add-llm-tracing-langfuse` emite `teko_langfuse_units_projected` (gauge, sem labels); a F7 emite
`teko_vercel_usage_ratio{resource}` e
`teko_ops_job_last_success_timestamp_seconds{ops_job="vercel-usage"|"weekly-maintenance"}`
(`scripts/vercel-usage.ts`, a cada 10 min desde a mudança `fix-vercel-usage-hobby`, e
`scripts/ops-metrics.ts --success-only`, mudança `add-usage-guard`) e
`teko_prod_vuln_findings{severity}`, todos pelo `scripts/lib/otlp-metrics.ts` (gauges sem `unit`, `service.name=teko-ops`). Métrica empurrada
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
   `NEON_API_KEY_PROD` e `NEON_API_KEY_STAGING` (API keys **project-scoped**). O Neon não tem chave
   só de leitura: a project-scoped tem papel **Editor** no projeto, lê e altera os recursos dele,
   mas não apaga o projeto nem gerencia quem tem acesso
   ([doc do Neon](https://neon.com/docs/manage/api-keys)). O risco fica contido por três motivos: a
   chave vale para um projeto só, mora apenas no environment `ops` (só `main`), e o job `quotas` só
   faz `GET /projects/{id}`. Prefira chaves próprias do `ops`: reaproveitar as dos environments
   `release-rehearsal` e `staging` funciona, mas a mesma chave passa a morar em dois lugares.
9. **Tokens com validade:** variável `TOKEN_EXPIRY_DATES` em JSON, nome → data de expiração
   (`{"VERCEL_TOKEN (staging)": "2027-02-14", "VERCEL_TOKEN (production)": "2027-02-14",
   "VERCEL_USAGE_TOKEN": "2027-02-14", "GRAFANA_SA_TOKEN": "2027-11-16"}`). Atualize a cada
   rotação.
10. O job `coverage-age` usa o environment `corpus-watch` que já existe (`NEON_PROD_WATCH_URL` e
    `NEON_STAGING_WATCH_URL`); nada a criar.
11. **Langfuse (job `langfuse`):** em cada projeto do Langfuse Cloud EU (`teko-prod` e
    `teko-staging`), Settings → API Keys → um par **separado** do de runtime da Vercel: segredos
    `LANGFUSE_PROD_PUBLIC_KEY`, `LANGFUSE_PROD_SECRET_KEY`, `LANGFUSE_STAGING_PUBLIC_KEY` e
    `LANGFUSE_STAGING_SECRET_KEY`. Opcional: variável `LANGFUSE_BASE_URL` (padrão
    `https://cloud.langfuse.com`). O job usa o mesmo `GRAFANA_OTLP_*` do item 5.
12. **Vercel (job `vercel-usage`, F7):** segredo `VERCEL_USAGE_TOKEN` (Vercel → Account Settings →
    Tokens, escopo **só o time Hobby** dos projetos `tekoia` e `tekoia-staging`, validade de 90
    dias, a data em `TOKEN_EXPIRY_DATES`) e variável `VERCEL_ORG_ID` (o ID do time, `team_...`, em
    Team Settings → General). O token lê o uso da conta e, na guarda, grava `LLM_KILL_SWITCH`,
    redeploya, promove e muda a regra 1 do WAF; a Vercel não tem token com escopo menor que o
    time. Sem ele, o job avisa e termina verde. Runbook:
    [budget-kill-switch.md](../../docs/runbooks/budget-kill-switch.md).
13. O job `weekly-maintenance` (F7) usa o environment `maintenance` que já existe
    (`NEON_PROD_APP_URL` e `NEON_STAGING_APP_URL`, role `teko_app`); o sucesso dele é registrado
    pelo `weekly-maintenance-metrics`, no `ops`, com o mesmo `GRAFANA_OTLP_*` do item 5.

Depois, rode o `ops.yml` com `dry_run` e confira o plano; em seguida sem `dry_run`. Inputs do
dispatch: `job` (`all` = os diários, ou um job só, inclusive o `weekly-maintenance`),
`maintenance_target` (`staging`, `production` ou `both`), `kill_switch` (`none`, `0.85`, `0.95` ou
`release`) e `kill_switch_target` (`staging` ou `production`).
