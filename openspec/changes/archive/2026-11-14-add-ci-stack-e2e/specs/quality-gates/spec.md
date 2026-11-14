# Spec Delta

## MODIFIED Requirements

### Requirement: Check agregador único

Todo PR para `main` MUST ser aprovado pelo check `ci-gate`, que SHALL falhar quando
qualquer job agregado (`affected`, `ci`, `security`, `perf`, `e2e`) falhar ou for cancelado, e SHALL
rodar com `!cancelled()`, nunca com `always()`. Só `perf` e `e2e`, que pulam inteiros sem o escopo
deles, MAY terminar como `skipped`. A análise do SonarQube Cloud MUST NOT fazer parte do `ci-gate`:
ela é só informativa.

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

#### Scenario: E2E reprovado

- **WHEN** uma jornada do Playwright falha na stack de CI num PR que altera `apps/api`
- **THEN** o job `e2e` fica vermelho e o `ci-gate` também

## ADDED Requirements

### Requirement: E2E na stack de CI

Um PR que afeta `apps/web` ou `apps/api` MUST rodar o Playwright (Chromium e viewport mobile) contra
a stack descartável de `infra/ci`, com o estático e a API na mesma origem, a fixture única, LLM e
embeddings fake e uma sessão de teste criada sem endpoint HTTP; a stack SHALL usar só segredos
gerados na subida e nunca falar com provedor real.

#### Scenario: Pergunta pela mesma origem

- **WHEN** o e2e faz uma pergunta com a sessão de teste e abre o stream na stack de CI
- **THEN** o stream termina com `finish` e `[DONE]`, e a pergunta fica `answered`
