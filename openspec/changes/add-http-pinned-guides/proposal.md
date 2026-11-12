# Proposal

## Why

A cobertura da EFD ICMS/IPI começa em 2025-01-01 porque os Guias Práticos anteriores ao 3.1.9 só
existem no portal antigo `sped.rfb.gov.br`, que recusa https, e o `SafeFetcher` só aceita https.
Quem retifica uma EFD de 2022 ou responde a uma fiscalização de 2023 fica sem resposta, e a
consciência de vigência é justamente o diferencial do Tekó. O fisco revisa, em regra, até cerca de
5 anos para trás; por isso o mantenedor decidiu (2026-11-12) habilitar os Guias com efeitos de
2021 em diante.

## What Changes

- `SafeFetcher`: exceção http, na porta 80, só para os hosts da lista `httpHosts`; o transporte
  usa `node:http` nesses saltos, com as mesmas defesas (DNS validado antes e na conexão, redirects
  revalidados, intervalo por host, teto de bytes, User-Agent fixo).
- Manifesto: fonte habilitada em http só no host `sped.rfb.gov.br` (`HTTP_PINNED_HOSTS`) e só no
  modo `pinned`, com sha256 obrigatório; o `discover` já recusa o arquivo cujo sha256 não bate. O
  `ingest` passa a lista ao `SafeFetcher`; o `sources-watch` não (nunca baixa fontes fixadas).
- Corpus: habilitados os Guias 3.0.6, 3.0.8, 3.1.2, 3.1.3 e 3.1.6 (leiautes 015 a 018, 2021–2024),
  com `page_ranges` de até 125 páginas. O 3.1.8 continua desabilitado: é do mesmo período do 3.1.9
  já publicado e mais antigo que ele, e uma corretiva mais antiga ingerida depois da mais nova
  inverteria o conhecimento de 2025. As versões sem efeitos e as de 2019–2020 também ficam de fora.
- `ingest.yml`: `sped.rfb.gov.br:80` na allowlist do harden-runner do `discover`; o contrato da
  matriz do `extract` aceita `http://sped.rfb.gov.br/` além de https.
- Golden: `recusa-efd-antes-da-cobertura` vai de 2022-03 para 2020-03 (2022 passa a ter cobertura).
- ADR 0028 registra a exceção.

## Capabilities

### Modified Capabilities

- `corpus-ingestion`: o manifesto aceita fonte fixada em http no host com exceção, e o download
  seguro ganha a exceção http por host.

## Impact

- `apps/api/src/adapters/out/http/safe-fetcher.ts`, `adapters/in/cli/ingest/sources.ts`,
  `composition-root.ts`, `cli.ts` e testes; `corpus/sources.yaml`, `corpus/README.md`,
  `corpus/leiaute-periods.yaml`; `.github/workflows/ingest.yml` e `ci-config.test.sh`; golden.
- Custo: cerca de 15 partes do Docling (uns 40 min de extract com 6 em paralelo) e embeddings só
  das redações que mudaram de um ano para o outro (ADR 0025), dentro do orçamento diário.
