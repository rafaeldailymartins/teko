## MODIFIED Requirements

### Requirement: Check agregador único

Todo PR para `main` MUST ser aprovado pelo check `ci-gate`, que SHALL falhar quando
qualquer job agregado (`affected`, `ci`, `security`, `perf`) falhar ou for cancelado, e SHALL rodar
com `!cancelled()`, nunca com `always()`. A análise do SonarQube Cloud MUST NOT fazer parte do
`ci-gate`: ela é só informativa.

#### Scenario: Job de lint falha

- **WHEN** o job `lint` do `ci.yml` falha num PR
- **THEN** o `ci-gate` fica vermelho e o PR não pode ser mesclado

#### Scenario: Pacote não afetado

- **WHEN** um PR altera só `apps/web`
- **THEN** os passos da API são pulados dentro dos jobs e o `ci-gate` continua verde se o resto passar

#### Scenario: Quality gate do Sonar reprovado

- **WHEN** o quality gate do SonarQube Cloud reprova o código novo de um PR com os demais jobs verdes
- **THEN** o `ci-gate` fica verde e o resultado do Sonar aparece só na decoração do PR

#### Scenario: Run cancelado por push novo

- **WHEN** um push novo no PR cancela o run anterior do `pr-gate.yml`
- **THEN** o `ci-gate` do run cancelado não roda, e vale o do run novo

### Requirement: Dependências vulneráveis bloqueadas

Um PR MUST falhar quando introduzir dependência de runtime com vulnerabilidade conhecida de
qualquer severidade ou licença fora da allowlist. Vulnerabilidades novas em dependências que o PR
não introduziu MUST NOT reprovar o PR: o `pnpm audit --prod --audit-level low` e o osv-scanner (sobre
os lockfiles npm e Python) SHALL rodar em push
para `main`, todo dia e antes dos deploys.

#### Scenario: Dependência com CVE

- **WHEN** um PR adiciona uma dependência de produção com CVE de severidade baixa
- **THEN** o `dependency-review` falha e o `ci-gate` fica vermelho

#### Scenario: Advisory novo sem relação com o PR

- **WHEN** sai um advisory para uma dependência que já estava em `main` e um PR só de documentação está aberto
- **THEN** o PR continua verde, e o `audit.yml` agendado ou o próximo push em `main` fica vermelho

### Requirement: Migrações expand/contract

Todo PR que adiciona migração MUST passar pelo `migration-guard`, que SHALL reprovar DROP ou
RENAME sem o label `contract`, `CREATE INDEX CONCURRENTLY` e qualquer alteração ou remoção de
migração já existente na base.

#### Scenario: DROP sem o label

- **WHEN** um PR adiciona uma migração com `ALTER TABLE ... DROP COLUMN` e não tem o label `contract`
- **THEN** o job `migration-guard` falha e o `ci-gate` fica vermelho

#### Scenario: Migração publicada alterada

- **WHEN** um PR edita uma migração que já está em `main`
- **THEN** o job `migration-guard` falha, mesmo com o label `contract`

### Requirement: Mutação noturna

O `mutation.yml` MUST rodar o Stryker de todos os pacotes toda noite em `main`, SHALL pular a
rodada quando não houver commit novo desde o último run verde, e SHALL falhar se o score de
`apps/api` (domain e application) ou de `packages/shared` ficar abaixo de 70. Nenhum workflow de PR
MUST chamar o `mutation.yml`.

#### Scenario: Score abaixo do limite

- **WHEN** um commit em `main` deixa o score do domínio de vigência em 65
- **THEN** o job `stryker` do run noturno seguinte falha

#### Scenario: Noite sem commit novo

- **WHEN** o último run verde do `mutation.yml` foi no mesmo SHA de `main`
- **THEN** o job `changes` sai com `run=false` e o job `stryker` é pulado

## REMOVED Requirements

### Requirement: Fluxo Git Flow verificado

**Reason**: o trunk-based (ADR 0033) tira as branches `release/*` e `hotfix/*` e o check
`gitflow-guard`: todo PR vai para `main`, e a produção sai por tag `v*`.

**Migration**: a parte do DCO continua no requisito "DCO em todo commit do PR". A fronteira de
produção passa a ser a tag `v*` (ruleset `release-tags` e revisor do environment `production`).

## ADDED Requirements

### Requirement: DCO em todo commit do PR

Todo commit humano de um PR para `main` MUST ter `Signed-off-by:` com o e-mail do autor, conferido
pelo check `dco`.

#### Scenario: Commit sem DCO no PR

- **WHEN** um PR contém um commit humano sem `Signed-off-by:`
- **THEN** o check `dco` falha
