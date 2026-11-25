# Runbook: Neon sem CU-h, sem transferência ou suspenso

Cobre os alertas `teko-neon-cu-hours`, `teko-neon-transfer-50` e `teko-neon-transfer-80`
(`infra/grafana/alerts.json`) e a falta de banco. O Neon Free dá, por projeto e por mês, 100 CU-h
e 5 GB de transferência pública (o que sai do banco para os clientes); ao acabar qualquer um dos
dois, o compute do projeto **fica suspenso até o ciclo virar** e toda rota com banco falha
([contas e cotas](../architecture/contas-e-cotas.md#neon)).
Metas: produção até 70 CU-h e staging até 40, já contando cerca de 0,7 CU-h do `mark-coverage`
diário e 0,6 do `coverage-age` do `ops.yml`.

## Onde ver

- Dashboard **Tekó · Cotas**: `teko_neon_compute_hours{project}` (CU-h do período),
  `teko_neon_cu_hours_ratio` (projeção linear do mês sobre 100 CU-h) e
  `teko_neon_data_transfer_ratio` (`data_transfer_bytes` do período sobre 5 GB, sem projeção), do
  job `quotas` do `ops.yml`, uma vez por dia. A leitura é a API do Neon (`GET /projects/{id}`), que não acorda o
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

<a id="transferencia-acima-da-cota"></a>

## Transferência acima da cota

Em 2026-11-18 o `teko-staging` passou de 5,09 GB no ciclo iniciado em 2026-11-10 e ficou suspenso
até ~2026-12-10. A transferência pública conta só o que **sai** do banco (o que a aplicação grava
não conta) e vem em rajadas, não em ritmo constante: por isso o alerta usa o valor do período, sem
projeção. Os 5 GB são do projeto inteiro (Postgres, Object Storage e Neon Functions juntos).

1. **50% (`teko-neon-transfer-50`, aviso):** ache o fluxo que leu o banco desde o início do ciclo
   (passo 3) e adie o que não é urgente para o próximo ciclo.
2. **80% (`teko-neon-transfer-80`, crítico):** o `ingest.yml` não começa sem o input
   `allow_high_transfer` (job `neon-transfer`, que lê a API do Neon antes de qualquer job tocar o
   banco). Segure ingestões, `corpus-eval` (inclusive o rótulo `corpus-eval` em PRs) e deploys do
   staging até o ciclo virar. Só libere a guarda com a conta do passo 3 dizendo que o run cabe.
3. **Achar o culpado:** compare o `teko_neon_data_transfer_ratio` dia a dia (painel "Neon:
   transferência pública do período sobre 5 GB") com os runs do dia de `ingest.yml`, `ops.yml`,
   `source-watch.yml` e `deploy.yml` (aba Actions ou a CLI do GitHub). Ordem de grandeza por
   execução no staging (~21 mil chunks; estimativas da mudança `fix-neon-egress`):

   | Fluxo                                                      | Lê do banco por execução                                  |
   | ---------------------------------------------------------- | --------------------------------------------------------- |
   | `ingest load` que exporta snapshot (versão do corpus nova) | ~130 MB (eram ~340 MB com o vetor em texto)               |
   | `ingest load` sem nada novo                                | < 1 MB (sem exportação nem poda)                          |
   | `ingest load` que publica versões                          | ~30 MB da poda (texto dos chunks abertos); vetores: 0     |
   | `corpus-eval` (dev, holdout e ajuste)                      | ~20 a 30 MB (evidências e pool de 50 candidatos por caso) |
   | smoke, system test, `mark-coverage`, `coverage-age`        | < 1 MB                                                    |

   Qualquer `SELECT` novo que traga `embedding` (o texto do `halfvec` tem ~12,7 KB por chunk, ~270
   MB no corpus inteiro) ou o corpus inteiro para fora do banco é o primeiro suspeito: faça o
   trabalho em SQL no servidor ou leia o vetor pelo binário (`halfvec-wire.ts`, ~2,8 KB).
4. **Suspenso:** siga a seção abaixo. No staging, as opções são **esperar o ciclo** (sem staging,
   sem ingestão e sem `corpus-eval` até lá; a produção recebe o corpus pelo snapshot do
   `corpus.lock.json`, que já está no GitHub Releases) ou **trocar de projeto**: um projeto Neon
   novo para o staging, montado como na contingência abaixo (roles, migração e o corpus pelo
   snapshot vigente), com os segredos `NEON_STAGING_*` e a variável `NEON_STAGING_PROJECT_ID` do
   environment `staging` trocados pelo mantenedor. A transferência é por projeto, então o novo
   começa zerado; volte ao original quando o ciclo virar e apague o temporário.

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
