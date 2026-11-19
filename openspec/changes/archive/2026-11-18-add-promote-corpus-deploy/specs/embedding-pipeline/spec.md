## MODIFIED Requirements

### Requirement: Promoção idêntica e segura

A promoção MUST recusar o snapshot se a migração do destino for diferente, se o destino estiver
numa versão mais nova (salvo `--rollback`; com `--lock`, nada é escrito) ou se o sha256 de algum
arquivo não conferir, e SHALL aplicar o snapshot numa transação, sem recalcular embeddings, com o
`verified_at` mais recente dos dois e as lacunas do snapshot mais as do destino detectadas depois da
exportação.

#### Scenario: Banco vazio

- **WHEN** o snapshot da fixture é promovido num banco vazio
- **THEN** a busca híbrida devolve, para todas as perguntas do golden, os mesmos resultados do staging, na mesma ordem

#### Scenario: Arquivo adulterado

- **WHEN** um byte de um arquivo do snapshot muda no store
- **THEN** a promoção falha antes de escrever no destino

#### Scenario: Promoção repetida

- **WHEN** o mesmo snapshot é promovido duas vezes
- **THEN** as contagens de todas as tabelas ficam iguais

#### Scenario: Lacuna já ingerida pelo staging

- **WHEN** o `verified_at` da produção avançou depois da ingestão e o snapshot vem sem a lacuna que o staging resolveu
- **THEN** a produção fica sem a lacuna, com o `verified_at` dela

## ADDED Requirements

### Requirement: Promoção pelo lock, idempotente

`snapshot promote --lock <arquivo>` MUST conferir o sha256 do `manifest.json` do store e a versão
dele contra o lock antes de ler o destino. Com o destino na versão do lock ou à frente dela, MUST
terminar sem escrever (`up-to-date` ou `target-newer`); nos demais casos SHALL promover com as
checagens da promoção por manifesto.

#### Scenario: Manifesto diferente do lock

- **WHEN** o sha256 do `manifest.json` do store difere do `manifestSha256` do lock
- **THEN** a promoção falha sem ler nem escrever no destino

#### Scenario: Deploy repetido

- **WHEN** a produção já está na versão do lock e o mesmo release é implantado de novo
- **THEN** a CLI imprime `status` `up-to-date` e nenhuma tabela do destino é escrita

#### Scenario: Lock sem snapshot

- **WHEN** o `corpus.lock.json` tem `snapshot` nulo
- **THEN** a CLI termina com falha sem chamar a promoção

### Requirement: CLI do snapshot sem embeddings

`cli snapshot export|promote` SHALL ler só a `DATABASE_URL` e a configuração do store dos artefatos
e MUST NOT exigir provedor nem credenciais de embeddings.

#### Scenario: Environment de produção

- **WHEN** o passo de promoção roda só com `DATABASE_URL`, `BLOB_STORE=github-releases`, `GITHUB_TOKEN` e `GITHUB_REPOSITORY`
- **THEN** a CLI valida o ambiente e conecta ao destino, sem erro de `EMBEDDINGS_PROVIDER`
