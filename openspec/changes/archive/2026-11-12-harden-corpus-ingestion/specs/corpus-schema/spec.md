# Spec Delta

## MODIFIED Requirements

### Requirement: Privilégio mínimo do source-watch

O role `teko_watch` MUST poder só ler `corpus.coverage` e atualizar `verified_at`, `gaps`,
`gap_reason` e `gap_entries`.

#### Scenario: Avanço diário do verified_at

- **WHEN** o `teko_watch` atualiza `verified_at` e `gaps` da cobertura do RCTE
- **THEN** a atualização é aceita

#### Scenario: Fora do permitido

- **WHEN** o `teko_watch` tenta mudar `covered` ou ler `corpus.chunks`
- **THEN** o Postgres responde `permission denied`
