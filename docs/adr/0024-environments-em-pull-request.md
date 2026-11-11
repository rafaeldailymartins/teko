---

status: accepted
date: 2026-11-11
decision-makers: Rafael Daily Santos Martins
---

# 0024 — Regra de branch dos environments em eventos `pull_request`

## Contexto e problema

O `release-gate.yml` (F9) roda em `pull_request` para `main` vindo de `release/*` ou `hotfix/*`, e
o job `neon-rehearsal` usa o environment `release-rehearsal`, que guarda a `NEON_API_KEY_PROD` e
hoje só aceita `release/*` e `hotfix/*`. O plano deixou para um spike da F0 saber contra qual ref o
GitHub avalia a regra de branch de um environment nesse evento: o head branch do PR ou
`refs/pull/N/merge`.

## Spike (2026-11-11)

Workflow temporário `spike-env-ref.yml` no PR
[#19](https://github.com/rafaeldailymartins/teko/pull/19) (head `chore/fecha-f0-f1`, base
`develop`), run 43053101578, com dois jobs que não leem segredos:

| Job                                                        | Resultado                                                                                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environment: evals` (todas as branches)                   | rodou                                                                                                                                              |
| `environment: release-rehearsal` (`release/*`, `hotfix/*`) | recusado antes do primeiro passo: `Branch "refs/pull/19/merge" is not allowed to deploy to release-rehearsal due to environment protection rules.` |

A regra é avaliada contra `refs/pull/N/merge`. O registro de deployment criado pelo GitHub leva o
head branch (`ref: chore/fecha-f0-f1`), mas não é ele que a regra confere. Um PR de
`release/v0.1.0` para `main` seria recusado do mesmo jeito.

## Decisão

Vale a contingência do plano: o `release-rehearsal` passa a aceitar todas as branches, e o job
`neon-rehearsal` filtra por `github.head_ref` (`startsWith(github.head_ref, 'release/') ||
startsWith(github.head_ref, 'hotfix/')`) e por `github.event.pull_request.head.repo.full_name ==
github.repository`.

A política do environment muda no mesmo PR que criar o `release-gate.yml` com esse filtro, por
decisão do mantenedor. Até lá nenhum workflow usa o `release-rehearsal`, e o segredo de produção
do Neon continua restrito a `release/*` e `hotfix/*`.

O `evals` já aceita todas as branches e não muda. Os environments usados por `push` e
`workflow_dispatch` em `develop`, `main` e tags (`staging`, `production`, `ops`, `corpus-watch`)
não são afetados: nesses eventos o ref é o próprio branch ou tag.

### Consequências

- Boa: o `release-gate.yml` funciona em PRs de release sem truques no ref.
- Ruim: a fronteira do `release-rehearsal` deixa de ser a regra do environment e passa a ser a
  condição do job. Quem pode empurrar branch no repositório (só o mantenedor) pode, em tese,
  escrever um workflow que use o environment a partir de outra branch. PRs de fork não recebem
  segredos de environment, então a exposição externa não muda.
