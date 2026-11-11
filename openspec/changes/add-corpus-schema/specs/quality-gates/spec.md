# Spec Delta

## ADDED Requirements

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
