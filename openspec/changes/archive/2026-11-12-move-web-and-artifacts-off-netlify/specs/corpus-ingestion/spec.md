# Spec Delta

## MODIFIED Requirements

### Requirement: Variáveis da ingestão

O `config/env.ts` MUST validar os pares de credenciais da ingestão (Netlify, Neon), o `BLOB_STORE`
com as credenciais do backend escolhido, `EMBED_NEURON_BUDGET` (0 a 10.000, padrão 8.000) e
`INGEST_MAX_DB_BYTES` (padrão 800 MB), e SHALL derrubar o boot da API publicada com credenciais da
ingestão (inclusive o `GITHUB_TOKEN`), sem citar o valor de um segredo.

#### Scenario: PAT da Netlify na Function

- **WHEN** a API sobe com `RUNTIME_TARGET=vercel` e `NETLIFY_AUTH_TOKEN` definido
- **THEN** o boot falha citando só o nome da variável

#### Scenario: Token do GitHub na API publicada

- **WHEN** a API sobe com `RUNTIME_TARGET=render` e `GITHUB_TOKEN` definido
- **THEN** o boot falha citando só o nome da variável

#### Scenario: Backend sem credencial

- **WHEN** a CLI roda com `BLOB_STORE=github-releases` e sem `GITHUB_TOKEN`
- **THEN** a validação falha nomeando `GITHUB_TOKEN`

## REMOVED Requirements

### Requirement: Artefatos de fonte no Netlify Blobs

**Reason**: os artefatos da ingestão saem do Netlify Blobs para o GitHub Releases do repositório
(ADR 0030); o Netlify Blobs fica só como backend de transição até a migração.

**Migration**: o requisito "Artefatos de fonte no BlobStore" substitui este; o `ingest
blobs-migrate` copia os stores do Netlify Blobs para os releases.

## ADDED Requirements

### Requirement: Artefatos de fonte no BlobStore

A ingestão MUST guardar o arquivo baixado no store `corpus-raw` e cada parte do Docling no store
`corpus-docling`, com a chave `{family}/{docSlug}/{versão}/{sha256}.{ext}`, pelo backend de
`BLOB_STORE` (o GitHub Releases do repositório, padrão, ou o Netlify Blobs até a etapa C2 da
ADR 0030), conferindo o sha256 de cada leitura. O `discover` SHALL reaproveitar o raw `pinned` já
gravado e pular as partes com `docling.json`.

#### Scenario: Segundo discover sem mudança

- **WHEN** o raw e o `docling.json` de uma versão já estão no BlobStore
- **THEN** a fonte não é baixada de novo e não entra na matriz do `extract`

#### Scenario: Asset adulterado

- **WHEN** o conteúdo baixado de um release não confere com o `digest` sha256 do asset
- **THEN** a leitura falha e nada é usado

### Requirement: Migração dos artefatos para o GitHub Releases

`cli ingest blobs-migrate [--store <nome>]... [--dry-run]` MUST copiar cada chave dos stores do
Netlify Blobs para o GitHub Releases, pular a chave que já está no destino com o mesmo sha256,
conferir o sha256 do destino depois de gravar e sair com código 1 se alguma chave falhar, depois
de tentar as demais.

#### Scenario: Segunda rodada

- **WHEN** a migração roda de novo sem mudança na origem
- **THEN** nenhuma chave é copiada e o resumo mostra todas como já iguais
