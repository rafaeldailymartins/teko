# deployment Specification

## Purpose

Define como o Tekó chega à Vercel em staging e produção (F7; ADRs 0017, 0029, 0033 e 0038): a
configuração dos projetos aplicada por código (env vars, WAF e lockdown), a identidade do commit no
artefato, o deploy do tarball atestado com smoke, promote e rollback, a produção só a partir de um
commit verde no staging e o ensaio das migrações no banco de produção.

## Requirements

### Requirement: Env vars do projeto aplicadas por código

Antes de cada deploy, `scripts/vercel-env-sync.ts --env <ambiente>` MUST aplicar no ambiente
Production do projeto Vercel as env vars Config de `infra/vercel/env.<ambiente>.json` cuja fase já
chegou, escrevendo só as que faltam ou têm valor diferente, como tipo não sensível. O script MUST
falhar antes de qualquer escrita se faltar alguma Sensitive obrigatória para a fase, SHALL nunca
escrever `LLM_KILL_SWITCH` e MUST nunca imprimir o valor de uma env var.

#### Scenario: Config defasada

- **WHEN** o projeto tem `LOG_LEVEL=debug` e o JSON pede `info`, e todas as Sensitive existem
- **THEN** o script edita só `LOG_LEVEL`, mantém as Config iguais e cria as que faltam

#### Scenario: Sensitive faltando

- **WHEN** falta `DATABASE_URL` (obrigatória desde a F2) no projeto
- **THEN** o script termina com 1 nomeando `DATABASE_URL`, sem nenhuma escrita

#### Scenario: Kill switch ligado

- **WHEN** o projeto tem `LLM_KILL_SWITCH=true`
- **THEN** o sync não a altera nem imprime o valor, e o resumo a cita só pelo nome

#### Scenario: Projeto trocado

- **WHEN** `VERCEL_PROJECT_ID` é o id de produção e o script roda com `--env staging`
- **THEN** o script termina com 1 antes de chamar qualquer escrita

### Requirement: WAF aplicado por código, com lockdown versionado

`scripts/vercel-firewall.ts` MUST aplicar as regras de `infra/vercel/firewall-rules.json` por nome,
escrevendo só o que difere. `--lockdown on` MUST trocar a regra `deny-unknown-api` pelo payload
`lockdown` do JSON, e `--lockdown off` MUST voltar à normal. Sem `--lockdown`, um lockdown ativo
SHALL ser mantido, com aviso.

#### Scenario: Projeto em dia

- **WHEN** as 3 regras do projeto têm o mesmo conteúdo do JSON
- **THEN** o script não escreve nada e informa `lockdown=off` e `changes=0`

#### Scenario: Lockdown pelo guarda de uso

- **WHEN** o guarda de uso roda `--env production --lockdown on`
- **THEN** a regra `deny-unknown-api` do `tekoia` passa ao payload de lockdown e `GET /api/v1/coverage` é negado na borda, enquanto `/healthz` responde

#### Scenario: Deploy durante o lockdown

- **WHEN** o deploy roda o sync sem `--lockdown` com o lockdown ativo
- **THEN** a regra 1 continua em lockdown, as outras são sincronizadas e o log traz um `::warning`

### Requirement: Identidade do commit no artefato

`scripts/build-vercel-output.ts` MUST gravar `GIT_SHA` (40 hex) e `APP_VERSION` (SemVer) no
`environment` do `.vc-config.json` da Function quando o build recebe o SHA, para que o tarball
atestado carregue o commit e o `/healthz` da deployment devolva o `gitSha` esperado. SHA ou versão
fora do formato MUST derrubar o build.

#### Scenario: Build do deploy

- **WHEN** o deploy monta o output com `GIT_SHA` do commit e `APP_VERSION=0.1.0-rc.1`
- **THEN** o `.vc-config.json` traz os dois em `environment` e o `/healthz` da deployment responde com o `gitSha` do commit

#### Scenario: Build local

- **WHEN** o script roda sem `GIT_SHA` nem `GITHUB_SHA`
- **THEN** o `.vc-config.json` sai sem `environment` e o `/healthz` responde `gitSha: unknown`

### Requirement: Deploy do tarball atestado

O `deploy.yml` MUST publicar em cada ambiente (`main` → staging; tag `v*` → produção) exatamente o
tarball atestado no mesmo run, por um build sem nenhum segredo. O deploy MUST conferir sha256 e
atestação antes de qualquer escrita, e o domínio canônico SHALL só ir para a deployment nova depois
do smoke da URL única.

#### Scenario: Push em main

- **WHEN** um PR entra em `main`
- **THEN** o staging recebe o tarball atestado daquele commit, o smoke da URL única e o do domínio canônico respondem com o `gitSha` do commit, e o resumo traz o sha256 verificado

#### Scenario: Atestação que não bate

- **WHEN** o tarball baixado no job de deploy não tem a atestação do `deploy.yml` para o commit ou o sha256 difere do build
- **THEN** o job para antes do migrate e nada é publicado

#### Scenario: Smoke da URL única falha

- **WHEN** o `/healthz` da deployment nova não devolve o `gitSha` esperado
- **THEN** o job falha sem `vercel promote`, e o domínio continua na deployment anterior

### Requirement: Rollback automático depois do promote

Uma falha depois do `vercel promote` (smoke canônico ou system test) MUST disparar `vercel rollback`
no mesmo job, e o resumo do run SHALL dizer que a atribuição automática do domínio ficou desligada
até o próximo `promote` e que env vars e migrações não voltam.

#### Scenario: Smoke canônico vermelho

- **WHEN** o domínio canônico não responde com o `gitSha` novo em 2 min depois do promote
- **THEN** o job roda `vercel rollback`, termina vermelho e o resumo traz a seção ROLLBACK

### Requirement: Produção só a partir de commit verde no staging

A tag `v*` de produção MUST ser criada só pelo `release.yml`, com o token da App
`teko-release-bot`, para uma versão SemVer válida (pré-release aceita) e só se o último deploy de
staging do SHA atual de `main` terminou verde. O deploy de produção MUST repetir essa checagem antes
do build.

#### Scenario: Release de um commit verde

- **WHEN** o mantenedor roda o `release.yml` com `0.1.0-rc.1` e o último deploy de staging do SHA de `main` está verde
- **THEN** a tag `v0.1.0-rc.1` é criada nesse SHA e o deploy de produção espera o revisor

#### Scenario: Staging vermelho ou versão inválida

- **WHEN** o último deploy de staging do SHA falhou, ou a versão é `v0.1` ou já existe
- **THEN** o `release.yml` falha sem criar a tag

### Requirement: Redeploy para rotação de Sensitive

O `deploy.yml` com `phase: redeploy` MUST fazer `vercel redeploy` da deployment de produção atual do
projeto (sem novo build nem migrate), depois do env sync, com smoke contra o `meta.gitSha` dela,
`promote` e rollback em falha depois do promote.

#### Scenario: Rotação

- **WHEN** o mantenedor troca uma Sensitive e roda o deploy com `phase: redeploy` em `main`
- **THEN** o staging passa a servir uma deployment nova do mesmo commit, que lê a Sensitive nova

### Requirement: Ensaio das migrações no banco de produção

O `neon-rehearsal.yml` (reutilizável) MUST criar um branch efêmero do `teko-prod` pela API do Neon,
rodar `drizzle-kit migrate` nele, conferir as extensões (`vector` >= 0.8.0, `unaccent`, `pg_trgm`,
`btree_gist`) e os `hnsw.*` em `pg_settings`, e SHALL apagar o branch sempre, mesmo com falha. Sem a
API key ou o id do projeto no environment `release-rehearsal`, MUST avisar e terminar verde.

#### Scenario: Migração quebrada

- **WHEN** uma migração nova falha no branch efêmero
- **THEN** o rehearsal fica vermelho, o branch é apagado e o deploy de produção não roda

#### Scenario: Environment vazio

- **WHEN** o `release-rehearsal` não tem `NEON_API_KEY_PROD`
- **THEN** o job registra um `::warning` e termina verde, sem chamar o Neon
