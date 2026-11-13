# corpus-ingestion Specification

## Purpose

Define de onde vem o corpus do Tekó e como a CLI o traz para o staging: o manifesto de fontes das
ondas C1 e C2 com os períodos de leiaute curados, o download seguro (SSRF), os artefatos no BlobStore
(GitHub Releases, ADR 0030), os overrides da revisão manual, os subcomandos `ingest discover` e `ingest load` do
`ingest.yml`, o `corpus.lock.json` e a regeneração da fixture a partir do staging.

Bibliotecas e serviços conferidos no Context7: `/websites/github_en_rest` (releases e assets, ADR 0030;
o `/netlify/primitives` do `@netlify/blobs` valeu até a etapa C2),
`/eemeli/yaml` (`parse` no schema core do YAML 1.2: datas
ficam como texto) e `/colinhacks/zod` (`discriminatedUnion`, `strictObject`, `partialRecord`).
Built-ins do Node 24: `node:https` (`lookup` por requisição), `node:dns`, `node:zlib`
(`inflateRawSync`, `crc32`) e `node:util` (`parseArgs`).

## Requirements

### Requirement: Manifesto de fontes versionado

O repositório MUST manter em `corpus/sources.yaml` todas as fontes das ondas C1 e C2, cada uma com
família, parser, URL e modo (`pinned` com sha256 obrigatório, `live` ou `ws-tabela`), e em
`corpus/leiaute-periods.yaml` os períodos meio-abertos dos leiautes. A CLI SHALL validar os dois
arquivos juntos; fonte que não pode ser baixada fica registrada com `enabled: false` e o motivo.

#### Scenario: Manifesto real válido

- **WHEN** o teste carrega `corpus/sources.yaml` e `corpus/leiaute-periods.yaml`
- **THEN** a validação passa, toda fonte habilitada é https ou fixada em http no host com exceção, e o Guia 3.1.9 resolve para `[2025-01-01, 2026-01-01)`, o Guia 3.2.4 para `[2026-01-01, ∞)`, a REINF 2.1.1 para `[2023-03-01, 2023-09-01)` e o Guia EFD-GO 5.8 para `[2025-10-02, 2026-03-16)`, como na fixture da F2

#### Scenario: Guia só disponível em http

- **WHEN** uma versão do Guia só existe no portal antigo `http://sped.rfb.gov.br/`
- **THEN** ela pode ser habilitada no modo `pinned`, com sha256, e o Guia 3.0.6 resolve para `[2021-01-01, 2022-01-01)`

#### Scenario: Pin ausente ou leiaute desconhecido

- **WHEN** uma fonte `pinned` habilitada não tem sha256, ou cita um código de leiaute que não existe
- **THEN** a CLI recusa o manifesto com a lista de problemas, antes de qualquer download

### Requirement: Vigência da versão de documento resolvida pelo pipeline

A CLI MUST entregar ao parser o `SourceDescriptor` com a vigência da versão de documento já
calculada: período do leiaute até o início do período seguinte entre as versões habilitadas (Guia,
REINF), período do leiaute com efeito no início dele (NT), `[published_on, próxima publicação)`
(Guia EFD-GO) ou nenhuma (consolidados e tabelas, cuja versão vem do conteúdo).

#### Scenario: Corretivas do mesmo período

- **WHEN** os Guias 3.2.0 a 3.2.4 apontam para o leiaute 020
- **THEN** todos recebem `[2026-01-01, ∞)` e a reconciliação fecha o conhecimento da anterior em `published_on`

#### Scenario: Tabela do WS

- **WHEN** o `discover` lê a Tabela 5.5 de Goiás
- **THEN** o descritor leva os metadados `{id, versao, desc, dtVersao, hash}` do `consultarVersoesTabelasExternas` e a URL com `idTabela` e `versao`

### Requirement: Download seguro das fontes

Todo download da ingestão MUST passar pelo `SafeFetcher`: só `https` na porta 443 e sem
credenciais, host da allowlist, DNS resolvido antes e de novo na conexão sem endereço privado,
link-local, de metadata ou reservado (IPv4, IPv6 e IPv4 embutido), no máximo 3 redirects
revalidados, 1 requisição por segundo por host, User-Agent fixo e teto de bytes.

#### Scenario: Redirect para o metadata da nuvem

- **WHEN** uma fonte responde 307 para `https://169.254.169.254/`
- **THEN** a requisição é recusada com `BlockedRequestError` antes de qualquer conexão ao destino

#### Scenario: DNS rebinding

- **WHEN** o host passa na checagem e, na conexão, o DNS resolve para `127.0.0.1`
- **THEN** o `lookup` da conexão falha e nenhum byte é trocado com o endereço interno

### Requirement: Novas tentativas do download

No `SafeFetcher`, erro de rede transitório e respostas 502, 503 e 504 SHALL ter até 2 novas
tentativas, com espera crescente e dentro do mesmo timeout; bloqueio de segurança e cancelamento
MUST NOT ser repetidos.

#### Scenario: Conexão reiniciada pelo servidor da fonte

- **WHEN** o download do RCTE falha com `ECONNRESET` e a tentativa seguinte responde 200
- **THEN** o download termina com o arquivo, depois de uma espera de 2 s, sem derrubar o run

### Requirement: Subcomando ingest discover

`cli ingest discover --target staging|production --out <dir> [--family …]` MUST baixar as fontes
habilitadas, conferir o sha256 das `pinned` e gravar os arquivos, o `plan.json` e o
`extract-matrix.json` (no máximo 256 partes, `id` igual ao diretório de saída do `teko-ingest`), e
SHALL sair com código 1 se alguma fonte falhar, depois de gravar o plano com os erros.

#### Scenario: Pin divergente

- **WHEN** o PDF publicado de um Guia tem sha256 diferente do `sources.yaml`
- **THEN** o plano registra `PinMismatchError` para a fonte, as demais seguem no plano e o código de saída é 1

### Requirement: Subcomando ingest load

`cli ingest load --target staging|production --plan <plan.json> --docling-dir <dir>` MUST aceitar
`--migrate` e `--bulk` só no staging e carregar as versões de cada documento em ordem de
`published_on`, com uma linha por item; no fim SHALL passar pelo gate de saúde, recalcular a
cobertura, exportar o snapshot se a versão do corpus mudou, atualizar o `corpus.lock.json` só se o
conteúdo mudou e gravar o relatório (`--report`).

#### Scenario: Fila de revisão no relatório

- **WHEN** o run deixa redações `pending` na fila
- **THEN** o relatório traz os itens abertos por família e motivo

#### Scenario: Segunda execução sem mudança

- **WHEN** o mesmo plano é carregado de novo
- **THEN** todas as versões voltam `unchanged`, nenhum embedding é chamado, nenhum snapshot é exportado e o `corpus.lock.json` não é reescrito

#### Scenario: Migração fora do staging

- **WHEN** o load é chamado com `--target production --migrate`
- **THEN** a CLI recusa com código 64, sem abrir run

### Requirement: Códigos de saída do load

O `load` MUST sair com 75 quando o orçamento de neurons ou a cota diária do provedor acabar (run
`budget_exhausted`, sem snapshot) e com 1 quando alguma fonte falhar ou o gate de saúde reprovar
(run `failed`, sem cobertura recalculada, snapshot nem lock), sem que a falha de uma fonte impeça as
demais.

#### Scenario: Orçamento esgotado

- **WHEN** `ingestDocumentVersion` devolve `budget_exhausted` no meio do plano
- **THEN** o load para, fecha o run como `budget_exhausted`, sai com 75, e o run seguinte com orçamento publica a partir do `embedding_cache`

#### Scenario: Fonte com erro

- **WHEN** o parser de uma fonte lança erro e as outras parseiam
- **THEN** as outras são ingeridas, o run fecha como `failed` com o erro no relatório e o código de saída é 1

### Requirement: Overrides da revisão manual

A ingestão MUST aplicar, entre o parser e a gravação, as resoluções de `corpus/overrides/*.yaml`,
com a chave `(stable_key, note_hash)` da `review_queue` e a ação `approve`, `reject` ou
`set_interval`, mais motivo, revisor e data. A redação resolvida SHALL chegar ao banco sem `review`,
como `approved` ou `rejected`; a mesma chave em dois arquivos derruba o load.

#### Scenario: Nota corrigida na revisão

- **WHEN** um override `set_interval` casa com a anomalia de um parágrafo do RCTE
- **THEN** a redação é gravada `approved` com o intervalo do override e não volta para a fila

### Requirement: Fixture regenerada a partir do staging

`cli eval-fixture export --from staging --out <dir>` MUST reescrever `documents/<slug>.json` e
`coverage.json` no formato do `seed-fixtures`, limitados aos documentos e dispositivos que a fixture
atual já tem, e SHALL falhar se algum documento da fixture faltar no staging.

#### Scenario: Dispositivo fora da fixture

- **WHEN** o staging tem o art. 77 do RCTE e a fixture não
- **THEN** o art. 77 não entra na fixture exportada

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

### Requirement: Exceção http para fontes fixadas

Como exceção ao https do download seguro, uma fonte habilitada MAY usar `http://` só num host da
lista de exceção do manifesto (hoje `sped.rfb.gov.br`) e só no modo `pinned`, com sha256. O
`SafeFetcher` SHALL aceitar http, na porta 80, só nos hosts que o `ingest` lhe passa como exceção,
com as demais defesas do download seguro; o `sources-watch` MUST NOT receber exceção.

#### Scenario: Fonte http fora da exceção

- **WHEN** uma fonte habilitada aponta para `http://www.gov.br/...`, ou para `http://sped.rfb.gov.br/...` no modo `live`
- **THEN** a CLI recusa o manifesto antes de qualquer download

#### Scenario: Redirect para http de outro host

- **WHEN** o download de `http://sped.rfb.gov.br/` responde 302 para `http://www.gov.br/x`
- **THEN** a requisição é recusada com `BlockedRequestError`, porque o destino não tem exceção http

#### Scenario: Arquivo trocado no caminho

- **WHEN** o arquivo baixado em http tem sha256 diferente do pin
- **THEN** o `discover` registra `PinMismatchError` para a fonte e nada é gravado no Blobs

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
