# Runbook: alertas de operação (cobertura, jobs do `ops.yml` e sinais de RAG)

Cobre os alertas sem runbook temático próprio: `teko-coverage-stale`, `teko-ops-job-stale`,
`teko-prod-vuln-scan` e `teko-rag-refusal-anomaly` (`infra/grafana/alerts.json`). Os jobs do
`ops.yml` e as métricas que eles empurram estão em [infra/grafana/README.md](../../infra/grafana/README.md).

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
O alerta olha o `vercel-usage` (mais de 30 h) e o `weekly-maintenance` (mais de 8 dias), ambos da
F7; o `quotas` da F6 aparece no dashboard **Tekó · Cotas**.

1. Actions → Ops → último run do job: a falha diz qual segredo faltou ou qual API respondeu erro.
2. Segredo vencido (tokens da Vercel duram 90 dias): `secret-rotation.md` (F7) e atualize a data
   em `TOKEN_EXPIRY_DATES`.
3. `vercel-usage` parado é o mais grave: sem ele, o kill switch de 85% não liga sozinho. Até
   voltar, confira o uso à mão (Vercel → Usage) todo dia.

<a id="prod-vuln-scan"></a>

## Achado do `prod-vuln-scan`

O job diário (F7) roda o `pnpm audit --prod` e o osv-scanner no commit da produção e empurra
`teko_prod_vuln_findings{severity}`. Achado high ou critical:

1. Leia o advisory no resumo do job e confirme se o código vulnerável é alcançável no Tekó.
2. Corrija pelo Dependabot (PR de segurança) ou por um override exato no `pnpm-workspace.yaml`,
   com a justificativa da [ADR 0002](../adr/0002-supply-chain-pnpm.md).
3. Publique como hotfix: release patch a partir de `main`
   ([CI/CD](../architecture/ci-cd-e-ambientes.md#releases-git-cliff--app-teko-release-bot)).

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
