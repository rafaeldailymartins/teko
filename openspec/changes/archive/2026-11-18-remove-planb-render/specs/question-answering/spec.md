## ADDED Requirements

### Requirement: Drenagem do processo Node

Em drenagem (SIGTERM com `RUNTIME_TARGET=node`: stack de CI, Docker e `pnpm dev`), perguntas e
streams novos MUST receber 503 `service_paused`, e os streams em andamento SHALL terminar.

#### Scenario: SIGTERM na stack de CI

- **WHEN** o processo entrou em drenagem e chega uma pergunta nova
- **THEN** a API responde 503 `service_paused`

## REMOVED Requirements

### Requirement: Drenagem fora da Vercel

**Reason**: o cenário citava o Render, que deixou de ser plataforma (ADR 0039); fora da Vercel só
resta o processo Node.

**Migration**: o mesmo comportamento está em "Drenagem do processo Node".
