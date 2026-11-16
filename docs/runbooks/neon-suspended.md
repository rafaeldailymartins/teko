# Runbook: Neon sem CU-h ou suspenso

Cobre o alerta `teko-neon-cu-hours` (`infra/grafana/alerts.json`) e a falta de banco. O Neon Free
dá 100 CU-h por projeto por mês; ao acabar, o compute do projeto **fica suspenso até o ciclo
virar** e toda rota com banco falha ([contas e cotas](../architecture/contas-e-cotas.md#neon)).
Metas: produção até 70 CU-h e staging até 40, já contando cerca de 0,7 CU-h do `mark-coverage`
diário e 0,6 do `coverage-age` do `ops.yml`.

## Onde ver

- Dashboard **Tekó · Cotas**: `teko_neon_compute_hours{project}` (CU-h do período) e
  `teko_neon_cu_hours_ratio` (projeção linear do mês sobre 100 CU-h), do job `quotas` do
  `ops.yml`, uma vez por dia. A leitura é a API do Neon (`GET /projects/{id}`), que não acorda o
  compute; os números são aproximados e chegam com algum atraso.
- Neon Console → projeto → Usage, com o início do período de cobrança.

<a id="cu-h-acima-de-70-pro-rata"></a>

## CU-h acima de 70% pró-rata

1. Descubra quem consome: ingestão (`ingestion_runs.cu_seconds` no staging), tráfego (dashboard
   **Tekó · API (RED)**) ou algo que impede o scale-to-zero (conexão presa, monitor batendo numa
   rota com banco). O `/healthz` nunca toca o banco (`get-health.ts`, teste "GET /healthz sem
   banco" em `test/integration/http/foundation.test.ts`), então o Synthetic Monitoring não conta.
2. Staging: adie ingestões grandes (`ingest.yml`) para o próximo ciclo e reduza os tetos do
   staging (`QUOTA_QUESTIONS_GLOBAL_DAILY`).
3. Produção: reduza `QUOTA_QUESTIONS_GLOBAL_DAILY` (menos perguntas que chegam ao banco) e confira
   se o cache de respostas está acertando (dashboard **Tekó · Sinais de RAG**, "Cache hit").
4. Projeção acima de 95%: ligue o kill switch antes de o Neon suspender (abaixo), para o
   estouro não derrubar também login e histórico no fim do mês.

## Neon suspenso (cota esgotada)

1. **`LLM_KILL_SWITCH=true`** no projeto Vercel afetado + redeploy da deployment atual: as
   perguntas param de gastar provedor sem resposta e a UI mostra a pausa em vez de erro genérico.
   Sem o banco, login, histórico e o cache de respostas ficam fora até o ciclo virar; o estático e
   o `/healthz` continuam no ar.
2. **Espere o ciclo do Neon** (início do próximo período de cobrança, no Console). Não há compra
   de CU-h no Free, e o Tekó não ativa plano pago.
3. Ao virar o ciclo, desligue o kill switch (`LLM_KILL_SWITCH=false` + redeploy) e confira o
   `/api/v1/coverage` e um login.

## Contingência opcional: projeto Neon novo

Só se a indisponibilidade até a virada for inaceitável, e só para a produção:

1. Crie um projeto Neon novo (`aws-sa-east-1`, PG 18) e os roles pelo
   [neon-roles.md](neon-roles.md), na ordem obrigatória (roles antes da migração).
2. `drizzle-kit migrate` com a URL do owner e promova o corpus pelo snapshot vigente
   (`cli snapshot promote --manifest <chave do corpus.lock.json>`, como no
   [rollback-corpus.md](rollback-corpus.md)).
3. Troque a `DATABASE_URL` Sensitive do projeto Vercel e os segredos dos environments (`gh secret
   set`), e faça redeploy. Os dados de usuário (contas, histórico) **não** vêm junto: avise na
   página de aviso.
4. Na virada do ciclo, volte ao projeto original e apague o temporário.
