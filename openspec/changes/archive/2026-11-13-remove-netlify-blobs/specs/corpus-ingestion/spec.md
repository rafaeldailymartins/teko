# Spec Delta

## MODIFIED Requirements

### Requirement: Variáveis da ingestão

O `config/env.ts` MUST validar o par `NEON_API_KEY_STAGING`/`NEON_STAGING_PROJECT_ID`, o
`BLOB_STORE` (só `github-releases`, que exige o `GITHUB_TOKEN`), `EMBED_NEURON_BUDGET` (0 a 10.000,
padrão 8.000) e `INGEST_MAX_DB_BYTES` (padrão 800 MB), e SHALL derrubar o boot da API publicada com
credenciais da ingestão (`GITHUB_TOKEN`, `NEON_API_KEY_STAGING`), sem citar o valor de um segredo.

#### Scenario: Token do GitHub na API publicada

- **WHEN** a API sobe com `RUNTIME_TARGET=render` e `GITHUB_TOKEN` definido
- **THEN** o boot falha citando só o nome da variável

#### Scenario: Backend sem credencial

- **WHEN** a CLI roda com `BLOB_STORE=github-releases` e sem `GITHUB_TOKEN`
- **THEN** a validação falha nomeando `GITHUB_TOKEN`

#### Scenario: PAT da Netlify na Function

- **WHEN** a CLI ou a API sobe com `BLOB_STORE=netlify` (o backend da Netlify saiu na etapa C2 da ADR 0030)
- **THEN** a validação falha nomeando `BLOB_STORE`, e as variáveis `NETLIFY_*` não são mais lidas

### Requirement: Artefatos de fonte no BlobStore

A ingestão MUST guardar o arquivo baixado no store `corpus-raw` e cada parte do Docling no store
`corpus-docling`, com a chave `{family}/{docSlug}/{versão}/{sha256}.{ext}`, no GitHub Releases do
repositório (ADR 0030), conferindo o sha256 de cada leitura. Sem `GITHUB_TOKEN` e sem `BLOB_STORE`
(execução local), a CLI SHALL usar o store em memória. O `discover` SHALL reaproveitar o raw
`pinned` já gravado e pular as partes com `docling.json`.

#### Scenario: Segundo discover sem mudança

- **WHEN** o raw e o `docling.json` de uma versão já estão no BlobStore
- **THEN** a fonte não é baixada de novo e não entra na matriz do `extract`

#### Scenario: Asset adulterado

- **WHEN** o conteúdo baixado de um release não confere com o `digest` sha256 do asset
- **THEN** a leitura falha e nada é usado

## REMOVED Requirements

### Requirement: Migração dos artefatos para o GitHub Releases

**Reason**: a migração terminou em 2026-11-13 (run 43355872236, 150 itens conferidos pelo sha256;
o dry-run seguinte deu os 150 já iguais), e o Netlify Blobs saiu (etapa C2 da ADR 0030).

**Migration**: nada a fazer; os artefatos estão no GitHub Releases, e o histórico do git guarda o
comando.
