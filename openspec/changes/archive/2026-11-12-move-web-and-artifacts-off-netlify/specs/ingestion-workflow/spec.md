# Spec Delta

## MODIFIED Requirements

### Requirement: Ingestão só no staging

O `ingest.yml` MUST aceitar só `target=staging` (dispatch e `workflow_call`) e SHALL falhar no
primeiro job, com a instrução de cadastro, se faltar a variável `NEON_STAGING_PROJECT_ID`, se o
`BLOB_STORE` declarado no workflow for desconhecido ou se faltar a credencial do backend dele (com
`netlify`, a variável `NETLIFY_SITE_ID` e o segredo `NETLIFY_AUTH_TOKEN` do environment `staging`;
com `github-releases`, o `GITHUB_TOKEN` do próprio job).

#### Scenario: Variável ausente

- **WHEN** o `BLOB_STORE` é `netlify` e o environment `staging` não tem `NETLIFY_SITE_ID`
- **THEN** o job `discover` falha antes do checkout com a mensagem que nomeia a variável e o comando `gh variable set`

#### Scenario: Produção pedida

- **WHEN** o workflow é chamado com `target=production`
- **THEN** o job `discover` falha e nenhuma fonte é baixada

### Requirement: Egress bloqueado

Todo job do `ingest.yml` MUST começar pelo harden-runner em `egress-policy: block`, com allowlist
por job; com `BLOB_STORE: netlify`, a do `discover` e a do `load` SHALL incluir `api.netlify.com`;
com `github-releases`, a do `load` SHALL incluir `uploads.github.com` e só o `load` SHALL ter
`contents: write`.

#### Scenario: Host fora da lista

- **WHEN** um passo tenta acessar um host que não está na allowlist do job
- **THEN** a conexão é bloqueada e o run fica vermelho

## ADDED Requirements

### Requirement: Workflow de migração dos artefatos

O `blobs-migrate.yml` MUST rodar só por `workflow_dispatch`, no environment `staging`, com
`contents: write`, harden-runner em `block` e o grupo de concorrência do `ingest.yml`, e SHALL
começar em `dry_run` por padrão.

#### Scenario: Ingestão durante a migração

- **WHEN** o `ingest.yml` é disparado enquanto o `blobs-migrate.yml` roda
- **THEN** a ingestão espera a migração terminar
