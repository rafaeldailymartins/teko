# quality-gates Specification

## Purpose

Define as verificações automáticas que toda mudança do Tekó passa antes de chegar a `develop` ou
`main`, com feedback local antecipado e um único check agregador obrigatório no PR.

## Requirements

### Requirement: Check agregador único

Todo PR para `develop` ou `main` MUST ser aprovado pelo check `ci-gate`, que SHALL falhar quando
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

### Requirement: Mensagens de commit convencionais

Todo título de PR, que vira a mensagem do squash, MUST seguir Conventional Commits com um tipo e um
escopo da lista única `.github/commit-types.json`, conferida pelo check `pr-title`.

#### Scenario: Escopo desconhecido

- **WHEN** um PR tem o título `feat(frontend): nova tela`
- **THEN** o check `pr-title` falha porque `frontend` não está em `.github/commit-types.json`

#### Scenario: Título de PR inválido

- **WHEN** um PR tem o título "ajustes"
- **THEN** o check `pr-title` falha

### Requirement: Lint e formatação sem avisos

O código MUST passar no Biome sem erros nem avisos (`biome ci --error-on-warnings`).

#### Scenario: Aviso de lint

- **WHEN** um arquivo alterado gera um aviso do Biome
- **THEN** o `pnpm lint` termina com código diferente de 0 localmente e no CI

### Requirement: Especificações válidas

As mudanças e specs do OpenSpec MUST passar em `openspec validate --all --strict --no-interactive`.

#### Scenario: Requisito sem cenário

- **WHEN** um delta traz um requisito sem `#### Scenario:`
- **THEN** o hook de pre-commit e o job `lint` do CI falham

### Requirement: Segredos bloqueados

Um commit ou PR que contenha um segredo MUST ser bloqueado pelo gitleaks antes do merge.

#### Scenario: Chave de API commitada

- **WHEN** um PR adiciona um arquivo com uma chave de API real
- **THEN** o job `gitleaks` do `security.yml` falha e o `ci-gate` fica vermelho

### Requirement: Dependências vulneráveis bloqueadas

Um PR MUST falhar quando introduzir dependência de runtime com vulnerabilidade conhecida de
qualquer severidade ou licença fora da allowlist. Vulnerabilidades novas em dependências que o PR
não introduziu MUST NOT reprovar o PR: o `pnpm audit --prod --audit-level low` SHALL rodar em push
para `develop`/`main`, todo dia e antes dos deploys.

#### Scenario: Dependência com CVE

- **WHEN** um PR adiciona uma dependência de produção com CVE de severidade baixa
- **THEN** o `dependency-review` falha e o `ci-gate` fica vermelho

#### Scenario: Advisory novo sem relação com o PR

- **WHEN** sai um advisory para uma dependência que já estava em `develop` e um PR só de documentação está aberto
- **THEN** o PR continua verde, e o `audit.yml` agendado ou o próximo push em `develop` fica vermelho

### Requirement: Fluxo Git Flow verificado

Um PR para `main` MUST vir de `release/vX.Y.Z` ou `hotfix/vX.Y.Z`, e todo commit humano do PR MUST
ter `Signed-off-by:`.

#### Scenario: Commit sem DCO no PR

- **WHEN** um PR contém um commit humano sem `Signed-off-by:`
- **THEN** o check `dco` falha

### Requirement: Tempo de CI

O caminho crítico do `ci-gate` SHALL terminar em até 8 minutos num PR típico com cache aquecido.

#### Scenario: PR típico

- **WHEN** um PR altera um pacote e o cache do Turborepo está aquecido
- **THEN** o `ci-gate` conclui em até 8 minutos

### Requirement: Migrações expand/contract

Todo PR que adiciona migração MUST passar pelo `migration-guard`, que SHALL reprovar DROP ou
RENAME sem o label `contract`, `CREATE INDEX CONCURRENTLY` e qualquer alteração ou remoção de
migração já existente na base.

#### Scenario: DROP sem o label

- **WHEN** um PR adiciona uma migração com `ALTER TABLE ... DROP COLUMN` e não tem o label `contract`
- **THEN** o job `migration-guard` falha e o `ci-gate` fica vermelho

#### Scenario: Migração publicada alterada

- **WHEN** um PR edita uma migração que já está em `develop`
- **THEN** o job `migration-guard` falha, mesmo com o label `contract`

### Requirement: Mutação noturna

O `mutation.yml` MUST rodar o Stryker de todos os pacotes toda noite em `develop`, SHALL pular a
rodada quando não houver commit novo desde o último run verde, e SHALL falhar se o score de
`apps/api` (domain e application) ou de `packages/shared` ficar abaixo de 70. Nenhum workflow de PR
MUST chamar o `mutation.yml`.

#### Scenario: Score abaixo do limite

- **WHEN** um commit em `develop` deixa o score do domínio de vigência em 65
- **THEN** o job `stryker` do run noturno seguinte falha

#### Scenario: Noite sem commit novo

- **WHEN** o último run verde do `mutation.yml` foi no mesmo SHA de `develop`
- **THEN** o job `changes` sai com `run=false` e o job `stryker` é pulado

### Requirement: PR só de documentação

Um PR cujos arquivos alterados estão todos no grupo `docs` do `.github/affected-paths.yml` MUST
rodar no job `lint` só o Biome, a guarda de lockfile e o `openspec validate`, e SHALL pular os jobs
de pacote, as evals e o `sql-perf`.

#### Scenario: Só ADR e README

- **WHEN** um PR altera só `docs/adr/0032-gates-e-ferramentas-enxutos.md` e `README.md`
- **THEN** o escopo sai com `code: false` e `packages: false`, e o `lint` pula knip, jscpd, os testes dos scripts e o actionlint

#### Scenario: Workflow agendado alterado

- **WHEN** um PR altera só o `.github/workflows/mutation.yml`
- **THEN** o escopo sai com `code: true` e nenhum grupo de pacote, e o `lint` roda inteiro (actionlint e `ci-config.test.sh`)
