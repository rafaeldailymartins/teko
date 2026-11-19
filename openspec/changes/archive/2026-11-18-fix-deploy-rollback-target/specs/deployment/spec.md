## MODIFIED Requirements

### Requirement: Rollback automático depois do promote

Uma falha depois do `vercel promote` (smoke canônico) MUST devolver o domínio, no mesmo job, à
deployment que estava nele antes do promote, por `vercel promote` dela, e conferir que o `/healthz`
do domínio devolve o `gitSha` dela; só sem deployment anterior conhecida o job SHALL usar
`vercel rollback`. O resumo do run SHALL trazer a seção ROLLBACK, com o tempo da volta, e dizer que
env vars e migrações não voltam.

#### Scenario: Smoke canônico vermelho

- **WHEN** o domínio canônico não responde com o `gitSha` novo em 2 min depois do promote
- **THEN** o job promove a deployment que estava no domínio, confere o `gitSha` dela no `/healthz`, termina vermelho e o resumo traz a seção ROLLBACK

#### Scenario: Exercício do rollback no staging

- **WHEN** o mantenedor roda o `deploy.yml` em `main` com `simulate_failure: true`
- **THEN** o deploy segue até o smoke canônico verde, falha de propósito e o domínio do staging volta à deployment anterior

#### Scenario: Exercício recusado na produção

- **WHEN** o `simulate_failure` vem num deploy de produção
- **THEN** o job `plan` termina com 1 antes de qualquer build ou deploy
