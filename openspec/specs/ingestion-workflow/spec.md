# ingestion-workflow Specification

## Purpose

Define o workflow de ingestão do Tekó no GitHub Actions: o que roda em cada job, com quais
segredos, com qual saída de rede e como o resultado chega ao repositório.

## Requirements

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

Quando o `corpus/corpus.lock.json` muda e o `corpus-eval` do mesmo run passa, o workflow MUST abrir
um PR para `main` a partir da branch `chore/corpus-lock-<run_id>`, com título
`chore(ingest): …`, usando o token da App `teko-release-bot` e um commit criado pela API (assinado
pelo GitHub) com `Signed-off-by`.

#### Scenario: Snapshot novo

- **WHEN** o `load` exporta um snapshot, atualiza o lock e o `corpus-eval` passa
- **THEN** o job `lock-pr` abre o PR com o commit Verified e o `pr-gate` roda nele

#### Scenario: corpus-eval reprovado

- **WHEN** o `load` atualiza o lock e o `corpus-eval` reprova
- **THEN** nenhum PR de lock é aberto e o resumo indica o modo `eval-only` para depois da correção

### Requirement: Resultado do corpus-eval no PR do lock

O commit do PR do lock MUST levar, ao lado do lock, o registro do `corpus-eval`
(`corpus/corpus.eval.json`), com a mesma `corpus_version` do lock, e o corpo do PR SHALL trazer a
`corpus_version` e as métricas dos conjuntos dev e holdout com o intervalo de confiança.

#### Scenario: Versões diferentes

- **WHEN** o lock traz a corpus_version 12 e o `corpus-eval` avaliou a 13
- **THEN** o `lock-pr` falha sem abrir PR

### Requirement: Egress bloqueado

Todo job do `ingest.yml` MUST começar pelo harden-runner em `egress-policy: block`, com allowlist
por job; só o `load` e o `corpus-eval-history` SHALL ter `contents: write` e `uploads.github.com`
na allowlist.

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

### Requirement: Avaliação do corpus em dois conjuntos

O `corpus-eval` MUST rodar as retrieval evals contra o staging nos conjuntos dev (`golden.yaml`) e
holdout (`holdout.yaml`) e SHALL aplicar os limites `retrieval-corpus` ao dev e
`retrieval-holdout` ao holdout, com o intervalo de confiança de 95% de cada métrica no resumo. O
holdout MUST NOT entrar nas retrieval evals da fixture do PR.

#### Scenario: Holdout reprovado

- **WHEN** um caso de recusa do holdout não é recusado
- **THEN** o `corpus-eval` falha e o PR do lock não é aberto

#### Scenario: Métrica informativa

- **WHEN** o MRR do holdout fica abaixo da meta de 0,70
- **THEN** o resumo mostra a meta não alcançada e o gate não reprova por isso

### Requirement: Modo eval-only

O `ingest.yml` MUST aceitar `mode: eval-only`, que pula discover, extract e load e roda só o
`corpus-eval` contra o estado atual do staging. Sem `ref`, com o eval verde e a `corpus_version`
do staging maior que a do lock de `main`, o `lock-pr` SHALL abrir o PR do lock a partir do
artifact `corpus-lock` que tem essa versão. Com `ref` (SHA de um PR do próprio repositório), o run
MUST avaliar esse código e MUST NOT abrir PR de lock nem gravar histórico.

#### Scenario: Golden corrigido depois de um eval vermelho

- **WHEN** o lock de `main` está na corpus_version 11, o staging na 12, e o `eval-only` passa depois da correção do golden
- **THEN** o PR do lock da corpus_version 12 é aberto com o lock do artifact do run que a exportou, sem reingerir

#### Scenario: Artifact exportado antes do rename

- **WHEN** a corpus_version do staging foi exportada por um run em `develop`, antes do rename para `main`, e o artifact ainda não expirou
- **THEN** o `lock-pr` usa esse artifact e abre o PR do lock para `main`

#### Scenario: PR de busca rotulado

- **WHEN** um PR do próprio repositório recebe o rótulo `corpus-eval`
- **THEN** o `ingest.yml` roda em `main` no modo `eval-only` com o SHA do PR e nenhum PR de lock é aberto

### Requirement: Histórico das avaliações

O `corpus-eval` MUST gravar o registro de cada run do código de `main` no store `eval-artifacts`
(chave `history/corpus-v<NNNNNN>/<run_id>.json`), também com o gate vermelho, e SHALL comparar no
resumo com o registro anterior.

#### Scenario: Segunda avaliação

- **WHEN** o `corpus-eval` roda para a corpus_version 12 depois de um registro da 11
- **THEN** o resumo mostra, por conjunto e métrica, o valor anterior, o atual e a diferença

### Requirement: Histórico do corpus-eval sem código de PR

O histórico do `corpus-eval` (store `eval-artifacts`) MUST ser gravado pelo job
`corpus-eval-history`, que roda o commit do próprio run, a partir do artifact `corpus-eval`, e
SHALL ser pulado quando o run avalia o código de um PR (`ref`); o `corpus-eval` MUST ficar só com
leitura.

#### Scenario: Eval-only de um PR

- **WHEN** o `ingest.yml` roda em `mode: eval-only` com o `ref` de um PR
- **THEN** o `corpus-eval` avalia o PR sem escrita nos releases e o `corpus-eval-history` não roda
