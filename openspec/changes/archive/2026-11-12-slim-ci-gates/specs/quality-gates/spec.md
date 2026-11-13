# Spec Delta

## MODIFIED Requirements

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

### Requirement: Dependências vulneráveis bloqueadas

Um PR MUST falhar quando introduzir dependência de runtime com vulnerabilidade conhecida de
qualquer severidade ou licença fora da allowlist. Vulnerabilidades novas em dependências que o PR
não introduziu MUST NOT reprovar o PR: o `pnpm audit --prod --audit-level low` e o osv-scanner (sobre
os lockfiles npm e Python) SHALL rodar em push
para `develop`/`main`, todo dia e antes dos deploys.

#### Scenario: Dependência com CVE

- **WHEN** um PR adiciona uma dependência de produção com CVE de severidade baixa
- **THEN** o `dependency-review` falha e o `ci-gate` fica vermelho

#### Scenario: Advisory novo sem relação com o PR

- **WHEN** sai um advisory para uma dependência que já estava em `develop` e um PR só de documentação está aberto
- **THEN** o PR continua verde, e o `audit.yml` agendado ou o próximo push em `develop` fica vermelho

## REMOVED Requirements

### Requirement: Mutação no PR

**Reason**: o Stryker era o caminho crítico do PR gate (4 a 7 min) e o score muda pouco entre
commits; passa a rodar só no noturno (ADR 0032).

**Migration**: o requisito "Mutação noturna" substitui este; quem quiser conferir uma mudança antes
do merge roda `pnpm test:mutation` localmente ou dispara o `mutation.yml` pelo `workflow_dispatch`.

## ADDED Requirements

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
