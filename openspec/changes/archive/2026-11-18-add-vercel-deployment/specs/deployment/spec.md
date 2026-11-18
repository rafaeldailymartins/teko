## ADDED Requirements

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
