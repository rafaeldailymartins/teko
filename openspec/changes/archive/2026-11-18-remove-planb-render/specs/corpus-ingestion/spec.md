## MODIFIED Requirements

### Requirement: Variáveis da ingestão

O `config/env.ts` MUST validar o par `NEON_API_KEY_STAGING`/`NEON_STAGING_PROJECT_ID`, o
`BLOB_STORE` (só `github-releases`, que exige o `GITHUB_TOKEN`), `EMBED_NEURON_BUDGET` (0 a 10.000,
padrão 8.000) e `INGEST_MAX_DB_BYTES` (padrão 800 MB), e SHALL derrubar o boot da API publicada com
credenciais da ingestão (`GITHUB_TOKEN`, `NEON_API_KEY_STAGING`), sem citar o valor de um segredo.

#### Scenario: Token do GitHub na API publicada

- **WHEN** a API sobe com `RUNTIME_TARGET=vercel` e `GITHUB_TOKEN` definido
- **THEN** o boot falha citando só o nome da variável

#### Scenario: Backend sem credencial

- **WHEN** a CLI roda com `BLOB_STORE=github-releases` e sem `GITHUB_TOKEN`
- **THEN** a validação falha nomeando `GITHUB_TOKEN`

#### Scenario: PAT da Netlify na Function

- **WHEN** a CLI ou a API sobe com `BLOB_STORE=netlify` (o backend da Netlify saiu na etapa C2 da ADR 0030)
- **THEN** a validação falha nomeando `BLOB_STORE`, e as variáveis `NETLIFY_*` não são mais lidas
