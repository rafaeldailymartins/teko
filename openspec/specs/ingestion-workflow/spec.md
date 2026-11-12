# ingestion-workflow Specification

## Purpose

Define o workflow de ingestão do Tekó no GitHub Actions: o que roda em cada job, com quais
segredos, com qual saída de rede e como o resultado chega ao repositório.

## Requirements

### Requirement: Ingestão só no staging

O `ingest.yml` MUST aceitar só `target=staging` (dispatch e `workflow_call`) e SHALL falhar no
primeiro job, com a instrução de cadastro, se faltarem a variável `NETLIFY_SITE_ID`, a variável
`NEON_STAGING_PROJECT_ID` ou o segredo `NETLIFY_AUTH_TOKEN` do environment `staging`.

#### Scenario: Variável ausente

- **WHEN** o environment `staging` não tem `NETLIFY_SITE_ID`
- **THEN** o job `discover` falha antes do checkout com a mensagem que nomeia a variável e o comando `gh variable set`

#### Scenario: Produção pedida

- **WHEN** o workflow é chamado com `target=production`
- **THEN** o job `discover` falha e nenhuma fonte é baixada

### Requirement: Extração sem segredos

O job `extract` MUST rodar um item da matriz por job, em `ubuntu-24.04`, com
`timeout-minutes: 330`, sem environment e sem ler segredos, e SHALL usar só os modelos do cache
`docling-<hash do uv.lock>` (rede do Hugging Face fora da allowlist).

#### Scenario: Matriz fora do contrato

- **WHEN** o `extract-matrix.json` traz um caminho com `..` ou mais de 256 itens
- **THEN** o `discover` falha e nenhum job de extração é criado

### Requirement: Retomada pelo orçamento

O job `load` MUST tratar o código de saída 75 do `cli ingest load` como "retomar no próximo
run": o job SHALL terminar verde, com `status=budget_exhausted` e aviso no resumo.

#### Scenario: Orçamento esgotado

- **WHEN** o `load` sai com 75 depois de gastar os neurons do dia
- **THEN** o job termina com sucesso, o `corpus-eval` é pulado e o resumo pede outro run

### Requirement: PR do lock assinado

Quando o `corpus/corpus.lock.json` muda, o workflow MUST abrir um PR para `develop` a partir da
branch `chore/corpus-lock-<n>`, com título `chore(ingest): …`, usando o token da App
`teko-release-bot` e um commit criado pela API (assinado pelo GitHub) com `Signed-off-by`.

#### Scenario: Snapshot novo

- **WHEN** o `load` exporta um snapshot e atualiza o lock
- **THEN** o job `lock-pr` abre o PR com o commit Verified e o `pr-gate` roda nele

### Requirement: Egress bloqueado

Todo job do `ingest.yml` MUST começar pelo harden-runner em `egress-policy: block`, com allowlist
por job; a do `discover` e a do `load` SHALL incluir `api.netlify.com`.

#### Scenario: Host fora da lista

- **WHEN** um passo tenta acessar um host que não está na allowlist do job
- **THEN** a conexão é bloqueada e o run fica vermelho

### Requirement: Escopo afetado da ingestão

O grupo `ingest` do `.github/affected-paths.yml` MUST cobrir `tools/ingest/**`, `corpus/**`,
`apps/api/src/domain/corpus/**`, `apps/api/src/adapters/in/cli/**` e os workflows
`ingest.yml` e `source-watch.yml`.

#### Scenario: Mudança no watch

- **WHEN** um PR muda só `corpus/watch.yaml`
- **THEN** o escopo afetado marca `ingest` e nenhum pacote JS
