# Proposal

## Why

As ondas C1 e C2 da F3 carregam o Guia Prático EFD ICMS/IPI, os leiautes da EFD-REINF, as Notas
Técnicas e o Guia Prático da EFD de Goiás. Cada fonte tem um formato (PDF convertido pelo Docling,
XSD) e uma regra de vigência própria (período de leiaute, NT facultativa/obrigatória, data de
publicação). Os parsers transformam cada versão de documento num `ParsedSource` com as mesmas
chaves, títulos e rótulos da fixture da F2, de que o golden e as retrieval evals dependem.

## What Changes

- Regras de vigência puras em `apps/api/src/domain/corpus/leiaute-validity.ts` (plano, "Regras de
  vigência", itens 1, 2 e 4): períodos de leiaute (`leiautePeriodIntervals`), estreitamento pelo
  início declarado ("campo incluído a partir de…", com revisão quando cai fora da vigência do
  documento), datas em português, vigência de NT (`optional`/`mandatory`/`retroactive`) e
  `[publicação, próxima publicação)` do Guia EFD-GO. As regras das Tabelas de Goiás (item 5) ficam
  no mesmo módulo e são especificadas na mudança `add-go-code-tables-ingestion`.
- Leitura do `DoclingDocument` JSON (`parsers/docling/docling-document.ts`): ordem de leitura do
  `body`, várias partes ordenadas pela página, grade das tabelas a partir de `table_cells`.
- Parser `docling-guia` (Guia Prático EFD ICMS/IPI): registro e campos, costura das tabelas que
  quebram de página, validações e notas "Campo NN".
- Parser `docling-generic` (Guia EFD-GO e NTs): tópicos por título numerado.
- Parser `reinf-xsd` (leiautes da EFD-REINF): evento, grupos e campos dos XSD com `htmlparser2` em
  `xmlMode`.
- Fixtures reais em `parsers/__fixtures__/{guia,efd-go,reinf,nt}/`: saída do Docling de páginas do
  Guia 3.2.4 (inclusive o C170, que quebra entre as páginas 80 e 81) e do Guia EFD-GO 5.9, e os
  XSD de R-2010, R-4020 e R-4080 do pacote 2.1.2.
- Fora de escopo: o registro dos parsers e a chamada pelo `cli ingest` (mudança
  `add-embedding-pipeline`, frente do pipeline), a reconciliação entre versões
  (`IngestDocumentVersion`) e o Docling em si (`add-docling-pdf-extraction`).

## Capabilities

### New Capabilities

- `sped-guides-ingestion`: parsers dos Guias, NTs e leiautes da REINF e as regras de vigência por
  leiaute e por publicação.

### Modified Capabilities

Nenhuma.

## Impact

- Código novo em `apps/api/src/domain/corpus/leiaute-validity.ts` e
  `apps/api/src/adapters/in/cli/ingest/parsers/`.
- Segmento `nt` (`ano-nnn`) na gramática da `stable_key` (`domain/corpus/provision-id.ts`), para
  as chaves das NTs (`br:efd-icms-ipi:nt:2025-001:item:3-1`).
- Nenhuma dependência nova (`htmlparser2` 12 e `zod` já estão no catálogo).
- O `SourceDescriptor` precisa trazer `versionLabel`, `publishedOn` e `versionValidDuring` para o
  Guia, a REINF e o Guia EFD-GO, e as datas de NT (`effectiveFrom`, `optionalFrom`,
  `mandatoryFrom`) para as NTs.
