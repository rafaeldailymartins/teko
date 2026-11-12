# Proposal

## Why

O RCTE e o CTE são publicados como HTML consolidado (Word, Windows-1252) em que cada redação
histórica de cada dispositivo fica no próprio documento, marcada pela classe do parágrafo e por
notas de vigência escritas à mão. A F2 carregou só um recorte curado à mão (fixture); a F3 precisa
ler os arquivos oficiais inteiros, com vigência meio-aberta por redação, chaves e rótulos
idênticos aos da fixture e as anomalias na fila de revisão. É a mudança `add-rcte-cte-html-parser`
da F3 do roteiro ("Ingestão das ondas C1 e C2, embeddings e watch").

## What Changes

- `apps/api/src/domain/corpus/validity.ts`: regras puras de vigência dos consolidados (pivô do
  ano de 2 dígitos, leitura das notas `NotaVigncia`, `NovaRedao`/`NovaRedRev` e inline, inclusivo
  → meio-aberto, "sem vigência", "EXAURIU-SE", prorrogação, retroativo, linha do tempo de um
  dispositivo, merge de redações idênticas, ausência de sobreposição, corte da reestruturação do
  CTE), com testes unitários e de propriedade.
- `apps/api/src/adapters/in/cli/ingest/parsers/go-html-state-machine.ts`: o `Parser`
  `go-html-state-machine` para RCTE e CTE (`TextDecoder('windows-1252')` explícito,
  `htmlparser2` 12 em streaming, máquina de estados por parágrafo, recorte do CTE no Título II,
  cabeçalho "CONSOLIDADO/ATUALIZADO ATÉ…", renumeração com `labels`, `stats` das notas), mais
  `parseConsolidatedWithDiagnostics` para a medição do DoD.
- Fixtures com bytes cp1252 reais em `parsers/__fixtures__/{rcte,cte}`: golden do art. 76 (§§ 5º
  a 10) com `art-76.expected.json`, casos "sem vigência", "exauriu-se", renumeração, estilo
  trocado, prorrogação e CTE de 1995 (pivô 91), e os Títulos III–IV do RCTE e o Título II do CTE
  inteiros em `.htm.gz` para a comparação com a fixture da F2.
- ADR 0011 "Docling + parser RCTE".
- Fora de escopo: o registro do parser em `parsers/index.ts`, o `sources.yaml` e o `cli ingest`
  (mudança `add-embedding-pipeline`, spec `corpus-ingestion`); a escrita no banco
  (`IngestDocumentVersion`); os Anexos VIII e IX do RCTE (onda C3, F10); a extração Docling dos
  PDFs (`add-docling-pdf-extraction`).

## Capabilities

### New Capabilities

- `rcte-cte-parser`: leitura dos consolidados de Goiás (RCTE e CTE) em dispositivos e redações
  com vigência meio-aberta, fila de revisão para as anomalias e números de conversão das notas.

### Modified Capabilities

Nenhuma.

## Impact

- Código novo em `apps/api/src/domain/corpus/validity.ts` e
  `apps/api/src/adapters/in/cli/ingest/parsers/go-html-state-machine.ts` (+ testes e fixtures).
- Dependência de runtime `htmlparser2` 12.0.0 (já no catálogo).
- ADR nova: 0011. ADRs relacionadas: 0003 (spike F1 (f)) e 0009 (vigência bitemporal).
- `.gitattributes`: as fixtures `.htm` precisam de `-text` para não terem os bytes cp1252
  normalizados (mudança aplicada pelo orquestrador).
