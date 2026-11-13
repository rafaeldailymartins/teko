# Spec Delta

## MODIFIED Requirements

### Requirement: Ingestão só no staging

O `ingest.yml` MUST aceitar só `target=staging` (dispatch e `workflow_call`) e SHALL falhar no
primeiro job, com a instrução de cadastro, se faltar a variável `NEON_STAGING_PROJECT_ID` do
environment `staging` ou se o `BLOB_STORE` declarado no workflow não for `github-releases`.

#### Scenario: Variável ausente

- **WHEN** o environment `staging` não tem `NEON_STAGING_PROJECT_ID`
- **THEN** o job `discover` falha antes do checkout com a mensagem que nomeia a variável e o comando `gh variable set`

#### Scenario: Produção pedida

- **WHEN** o workflow é chamado com `target=production`
- **THEN** o job `discover` falha e nenhuma fonte é baixada

### Requirement: Egress bloqueado

Todo job do `ingest.yml` MUST começar pelo harden-runner em `egress-policy: block`, com allowlist
por job; só o `load` e o `corpus-eval-history` SHALL ter `contents: write` e `uploads.github.com`
na allowlist.

#### Scenario: Host fora da lista

- **WHEN** um passo tenta acessar um host que não está na allowlist do job
- **THEN** a conexão é bloqueada e o run fica vermelho

## REMOVED Requirements

### Requirement: Workflow de migração dos artefatos

**Reason**: a migração do Netlify Blobs para o GitHub Releases terminou em 2026-11-13 (run
43355872236), e o `blobs-migrate.yml` saiu (etapa C2 da ADR 0030).

**Migration**: nada a fazer; o histórico do git guarda o workflow.

## ADDED Requirements

### Requirement: Histórico do corpus-eval sem código de PR

O histórico do `corpus-eval` (store `eval-artifacts`) MUST ser gravado pelo job
`corpus-eval-history`, que roda o commit do próprio run, a partir do artifact `corpus-eval`, e
SHALL ser pulado quando o run avalia o código de um PR (`ref`); o `corpus-eval` MUST ficar só com
leitura.

#### Scenario: Eval-only de um PR

- **WHEN** o `ingest.yml` roda em `mode: eval-only` com o `ref` de um PR
- **THEN** o `corpus-eval` avalia o PR sem escrita nos releases e o `corpus-eval-history` não roda
