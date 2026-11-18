# Runbook: alertas de operação (cobertura, jobs do `ops.yml`, checks sintéticos e sinais de RAG)

Cobre os alertas sem runbook temático próprio: `teko-coverage-stale`, `teko-ops-job-stale`,
`teko-prod-vuln-scan`, `teko-synthetic-failed` e `teko-rag-refusal-anomaly`
(`infra/grafana/alerts.json`). Os jobs do `ops.yml`, os checks e as métricas que eles empurram
estão em [infra/grafana/README.md](../../infra/grafana/README.md).

<a id="cobertura-sem-verificacao"></a>

## Cobertura sem verificação há mais de 3 dias

`teko_coverage_verified_age_days{family}` vem do job `coverage-age` do `ops.yml` (lê
`corpus.coverage` com o role `teko_watch`). Sem o avanço diário do `verified_at`, o
`CheckCoverage` recusa como `out_of_coverage` toda data depois dele.

1. Abra o último run do `source-watch.yml`:
   - **`watch-errors` vermelho:** uma página do `corpus/watch.yaml` não pôde ser verificada
     (site fora, mudança de layout, sinal ausente) e a família ficou de fora do avanço. O resumo do
     job `detect` diz qual página e por quê. Página fora do ar: espere e rode o workflow de novo
     (`workflow_dispatch`). Layout mudou: corrija o sinal em
     `apps/api/src/adapters/in/cli/sources-watch/` com a página real como fixture.
   - **`mark-coverage` vermelho:** banco inacessível ([neon-suspended.md](neon-suspended.md)) ou
     URL do `teko_watch` errada no environment `corpus-watch` ([neon-roles.md](neon-roles.md)).
   - **Workflow sem run recente:** o GitHub desliga crons de repositório sem atividade por 60 dias;
     reative em Actions → Source watch.
2. Uma família só e sem erro no `source-watch`: a família pode ter saído do `corpus/watch.yaml`;
   confira se ela ainda deve existir no corpus.

<a id="job-sem-sucesso"></a>

## Job do `ops.yml` sem sucesso

`teko_ops_job_last_success_timestamp_seconds{ops_job}` só é gravado quando o job termina sem erro.
O alerta olha o `vercel-usage` (diário, mais de 30 h) e o `weekly-maintenance` (domingo 06:00 UTC,
mais de 8 dias); o `quotas` da F6 aparece no dashboard **Tekó · Cotas**. Um job sem o segredo
avisa e termina verde, mas não registra sucesso: o alerta dispara do mesmo jeito.

1. Actions → Ops → último run do job: a falha diz qual segredo faltou ou qual API respondeu erro.
2. Segredo vencido (tokens da Vercel duram 90 dias): `secret-rotation.md` (F7) e atualize a data
   em `TOKEN_EXPIRY_DATES`.
3. `vercel-usage` parado é o mais grave: sem ele, o kill switch de 85% não liga sozinho
   ([budget-kill-switch.md](budget-kill-switch.md)). Até voltar, confira o uso à mão
   (Vercel → Usage) todo dia. Saída do `vercel billing usage` em formato novo (o job reprova com
   "unidade desconhecida" ou "nenhum recurso do relatório casou"): ajuste `HOBBY_QUOTAS` e o
   parser de `scripts/vercel-usage.ts` com a saída real como fixture do teste.
4. `weekly-maintenance`: o resumo traz a situação de cada banco. URL do `teko_app` errada no
   environment `maintenance`: [neon-roles.md](neon-roles.md); Neon suspenso:
   [neon-suspended.md](neon-suspended.md). Depois de corrigir, rode de novo: Actions → Ops → Run
   workflow com `job: weekly-maintenance`, `maintenance_target: both` e `dry_run: false`. O
   sucesso só é registrado pelo `weekly-maintenance-metrics` quando o purge rodou sem falha.

<a id="prod-vuln-scan"></a>

## Achado do `prod-vuln-scan`

O job diário (F7) roda o `pnpm audit --prod` e o osv-scanner no commit da produção e empurra
`teko_prod_vuln_findings{severity}`. Achado high ou critical:

1. Leia o advisory no resumo do job e confirme se o código vulnerável é alcançável no Tekó.
2. Corrija pelo Dependabot (PR de segurança) ou por um override exato no `pnpm-workspace.yaml`,
   com a justificativa da [ADR 0002](../adr/0002-supply-chain-pnpm.md).
3. Publique como hotfix: release patch a partir de `main`
   ([CI/CD](../architecture/ci-cd-e-ambientes.md#releases-git-cliff--app-teko-release-bot)).

<a id="check-sintetico-falhando"></a>

## Check sintético falhando há 20 min

`probe_success` (0 ou 1 por execução) ficou em 0 em todas as execuções de um check `teko-*` nos
últimos 20 min: 4 seguidas dos `/healthz` (5 min) e ao menos 1 da landing (15 min). O rótulo `job`
diz o check e `instance`, o alvo. O alerta volta a Normal na primeira execução com sucesso.

1. **O que a sonda viu:** Testing & synthetics → Synthetics → Checks → o check → logs das últimas
   execuções (motivo da falha: timeout, DNS, TLS, status, corpo sem o texto esperado). No Explore,
   `probe_http_status_code{job="<check>"}` e `probe_duration_seconds{job="<check>"}` mostram o
   status (0 quando não houve resposta) e quanto cada execução levou.
2. **Confira de fora:** `curl -sS -i <instance>` da sua máquina. Responde 200 com
   `"status":"ok"` (ou com a landing) enquanto a sonda falha: suspeite da sonda (passo 5).
3. **Queda da API** (só o `/healthz` de um projeto, com 500 ou 504 e `x-vercel-error`
   `FUNCTION_INVOCATION_FAILED` ou `FUNCTION_INVOCATION_TIMEOUT`, ou 200 sem `"status":"ok"`): a
   Function não sobe ou não responde certo. O `/healthz` não toca o banco, então o Neon não explica
   a falha. Veja os logs da deployment atual na Vercel e o dashboard **Tekó · API (RED)**; se começou
   num deploy, volte para a deployment anterior (`release-rollback.md`, F7). O `teko-api-5xx` costuma
   vir junto quando há tráfego.
4. **Queda da Vercel** (os dois projetos ao mesmo tempo, ou a landing junto com o `/healthz` de
   produção: ela é estática e não passa pela Function): confira
   [vercel-status.com](https://www.vercel-status.com/). Não há o que fazer além de acompanhar; se
   passar de horas, avalie o corte para o Plano B (`vercel-paused.md`, F7).
   - **503 no `/healthz`** é `DEPLOYMENT_PAUSED` (ou queda da plataforma): o
     `teko-deployment-paused` dispara já na primeira execução com 503, e este alerta vem uns 20 min
     depois, porque o check só aceita 200. Siga o [vercel-paused.md](vercel-paused.md); este alerta é
     consequência.
5. **Problema da sonda** (todos os checks falham juntos com timeout ou erro de conexão, status 0,
   enquanto o `curl` de fora e o tráfego real vão bem): Synthetics → Probes → `SaoPaulo` (online ou
   não) e [status.grafana.com](https://status.grafana.com/). Não há o que mudar no Tekó; o alerta
   some quando a sonda volta. Sonda desligada por completo não gera amostra, e o alerta fica em
   Normal (`noDataState: OK`): o painel do check mostra o buraco.
6. **Só a landing (`teko-landing-production`):** 404 é o web de produção fora do ar ou ainda não
   publicado; o check fica desligado (`enabled: false`) até o primeiro deploy do web de produção da
   F7. Corpo sem `Tekó` é deploy errado na raiz.

<a id="recusa-ou-lexical-only-fora-do-normal"></a>

## Recusa fora do normal

O alerta compara a recusa da última hora com a média de 7 dias (mais que o dobro, acima de 25% e
com pelo menos 20 respostas). Dashboard **Tekó · Sinais de RAG**, por motivo e `corpus_version`:

- **`out_of_coverage` subindo:** cobertura parada (seção acima) ou usuários perguntando por datas
  depois do `verified_at`.
- **`no_evidence` subindo junto com `lexical_only`:** embedding fora do ar
  ([provider-outage.md](provider-outage.md#embeddings)).
- **Subiu logo depois de uma `corpus_version` nova:** regressão do corpus que passou pelos gates;
  compare as versões no painel "Desfecho por corpus_version" e, confirmada, siga o
  [rollback-corpus.md](rollback-corpus.md).
- **`model_insufficient` ou `citation_invalid` subindo:** troca de modelo ou de prompt; veja os
  traces amostrados no Langfuse e o sentinel `INSUFICIENTE` no mesmo dashboard.
