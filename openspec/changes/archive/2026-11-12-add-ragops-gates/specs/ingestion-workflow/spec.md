# Spec Delta

## MODIFIED Requirements

### Requirement: PR do lock assinado

Quando o `corpus/corpus.lock.json` muda e o `corpus-eval` do mesmo run passa, o workflow MUST abrir
um PR para `develop` a partir da branch `chore/corpus-lock-<run_id>`, com título
`chore(ingest): …`, usando o token da App `teko-release-bot` e um commit criado pela API (assinado
pelo GitHub) com `Signed-off-by`.

#### Scenario: Snapshot novo

- **WHEN** o `load` exporta um snapshot, atualiza o lock e o `corpus-eval` passa
- **THEN** o job `lock-pr` abre o PR com o commit Verified e o `pr-gate` roda nele

#### Scenario: corpus-eval reprovado

- **WHEN** o `load` atualiza o lock e o `corpus-eval` reprova
- **THEN** nenhum PR de lock é aberto e o resumo indica o modo `eval-only` para depois da correção

## ADDED Requirements

### Requirement: Resultado do corpus-eval no PR do lock

O commit do PR do lock MUST levar, ao lado do lock, o registro do `corpus-eval`
(`corpus/corpus.eval.json`), com a mesma `corpus_version` do lock, e o corpo do PR SHALL trazer a
`corpus_version` e as métricas dos conjuntos dev e holdout com o intervalo de confiança.

#### Scenario: Versões diferentes

- **WHEN** o lock traz a corpus_version 12 e o `corpus-eval` avaliou a 13
- **THEN** o `lock-pr` falha sem abrir PR

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
do staging maior que a do lock de `develop`, o `lock-pr` SHALL abrir o PR do lock a partir do
artifact `corpus-lock` que tem essa versão. Com `ref` (SHA de um PR do próprio repositório), o run
MUST avaliar esse código e MUST NOT abrir PR de lock nem gravar histórico.

#### Scenario: Golden corrigido depois de um eval vermelho

- **WHEN** o lock de `develop` está na corpus_version 11, o staging na 12, e o `eval-only` passa depois da correção do golden
- **THEN** o PR do lock da corpus_version 12 é aberto com o lock do artifact do run que a exportou, sem reingerir

#### Scenario: PR de busca rotulado

- **WHEN** um PR do próprio repositório recebe o rótulo `corpus-eval`
- **THEN** o `ingest.yml` roda em `develop` no modo `eval-only` com o SHA do PR e nenhum PR de lock é aberto

### Requirement: Histórico das avaliações

O `corpus-eval` MUST gravar o registro de cada run do código de `develop` no store `eval-artifacts`
(chave `history/corpus-v<NNNNNN>/<run_id>.json`), também com o gate vermelho, e SHALL comparar no
resumo com o registro anterior.

#### Scenario: Segunda avaliação

- **WHEN** o `corpus-eval` roda para a corpus_version 12 depois de um registro da 11
- **THEN** o resumo mostra, por conjunto e métrica, o valor anterior, o atual e a diferença
