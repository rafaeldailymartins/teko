# Design

## Context

O job `deploy` promove a deployment nova com `vercel promote` depois do smoke da URL única e, em
falha depois do promote, rodava `vercel rollback`. No exercício manual da F7, depois de promover a
deployment do `rc.2` (que tinha parado no smoke), o `vercel rollback` respondeu "rolled back to" a
própria `rc.2`: o alvo é a deployment de produção criada antes da atual, não a que estava no ar.

## Decisions

- **Promote explícito da deployment anterior.** Um passo lê `targets.production` do projeto
  (`vercel api /v9/projects/{id}`) antes do promote e guarda URL e `meta.gitSha`. O rollback
  promove essa URL (cerca de 2 s no exercício) e espera o `/healthz` do domínio devolver o
  `gitSha` dela por até 1 min; se não devolver, o passo falha com `::error`. Sem deployment
  anterior conhecida (primeiro deploy), cai no `vercel rollback`.
- **Exercício só no staging.** `simulate_failure` é um input do dispatch; o `plan` recusa fora do
  staging, porque o exercício tira o domínio do ar por alguns segundos. A falha vem depois do smoke
  canônico verde, para que o caminho inteiro (promote, smoke, rollback) rode.
- **System test fora do rollback.** Ele roda em outro job, depois do `deploy`; a falha dele continua
  sem desfazer o promote (o runbook diz como voltar).

## Fontes (Context7)

- `/websites/vercel` (`vercel promote`, `vercel rollback`, `vercel api`), consultado em 2026-11-18;
  o comportamento do `vercel rollback` com deployments não promovidas foi observado no exercício.
