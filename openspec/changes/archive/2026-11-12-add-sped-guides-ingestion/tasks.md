# Tasks

## 1. Domínio

- [x] 1.1 `domain/corpus/leiaute-validity.ts`: períodos de leiaute, estreitamento pelo início declarado, datas em português, vigência de NT e `[publicação, próxima)` do Guia EFD-GO, com propriedades fast-check (sem sobreposição, nunca vazio, nunca fora da vigência do documento) — `vitest run --project unit src/domain/corpus/leiaute-validity.test.ts`
- [x] 1.2 Cobertura ≥ 95% (linhas 100%, ramos 95,45%) e Stryker ≥ 70 no arquivo (90,64)

## 2. Leitura do Docling

- [x] 2.1 `parsers/docling/docling-document.ts`: schema mínimo do `DoclingDocument` (zod), ordem de leitura do `body`, partes ordenadas pela página, grade a partir de `table_cells`
- [x] 2.2 `parsers/docling/field-table.ts`: cabeçalho, continuação de linha e validação da tabela de campos
- [x] 2.3 Fixtures reais do Guia 3.2.4 (páginas 17–18, 80–81 e 109–111) e do Guia EFD-GO 5.9 (páginas 3 e 26–29) geradas com as opções do `tools/ingest`

## 3. Parsers

- [x] 3.1 `docling-guia.ts`: registro e campos, costura entre páginas, validações, notas, estreitamento pelo Capítulo I; chaves, títulos, rótulos e `structured` conferidos com a fixture da F2 (C170 e C197)
- [x] 3.2 `docling-generic.ts`: tópicos do Guia EFD-GO (conferidos com a fixture) e das NTs (sintético)
- [x] 3.4 Segmento `nt` (`ano-nnn`) em `domain/corpus/provision-id.ts`, com teste em `provision-id.test.ts`, e chaves das NTs em `nt:<ano-nnn>` no `docling-generic`
- [x] 3.3 `reinf-xsd.ts`: XSD com `htmlparser2` em `xmlMode`; os 170 dispositivos da fixture com o mesmo título, rótulo, `sortPath`, pai e tipo

## 4. Verificação

- [x] 4.1 `vitest run --project unit` nos testes da frente, `biome check`, `depcruise` e o typecheck sem erros nos arquivos da frente
- [x] 4.2 Registro dos parsers em `parsers/index.ts` e chamada pelo `cli ingest load` (frente do pipeline, `add-embedding-pipeline`)
- [x] 4.3 Primeira ingestão real no staging pelo `ingest.yml` (depois do merge) — runs 43219953661 a 43287466540 (2026-11-12): Guias EFD ICMS/IPI, NTs, Guias EFD-GO e REINF 2.1.1 e 2.1.2 publicados, depois das correções da gramática da `stable_key` (REINF), das figuras do DoclingDocument e do registro 0000 e das linhas fundidas do Guia
