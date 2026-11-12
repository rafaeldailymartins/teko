# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
