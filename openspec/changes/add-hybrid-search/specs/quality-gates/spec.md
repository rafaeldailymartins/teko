# Spec Delta

## ADDED Requirements

### Requirement: Mutação no PR

Todo PR que afeta um pacote JS MUST rodar o Stryker nos pacotes afetados, em modo incremental, e
SHALL reprovar o `ci-gate` se o score de `apps/api` (domain e application) ou de `packages/shared`
ficar abaixo de 70.

#### Scenario: Teste fraco

- **WHEN** um PR muda o domínio de vigência com testes que não matam os mutantes e o score cai para 65
- **THEN** o job `stryker` do `mutation.yml` falha e o `ci-gate` fica vermelho

#### Scenario: PR só de documentação

- **WHEN** um PR não afeta nenhum pacote JS
- **THEN** o job `stryker` é pulado e o `ci-gate` continua verde se o resto passar
