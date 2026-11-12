# Tasks

## 1. Revisão do parser

- [x] 1.1 `PARSER_REVISIONS` em `parsers/index.ts` (todos os `ParserName`, `docling-guia` = 2) e teste do registro
- [x] 1.2 Coluna `corpus.document_versions.parser_revision` (padrão 1) e migração gerada pelo `drizzle-kit`
- [x] 1.3 `IngestDocumentVersion`: `unchanged` só com revisão igual ou maior; reprocessamento da mesma versão; `load` passa a revisão e conta `reprocessed`
- [x] 1.4 Snapshot exporta e promove `parser_revision`

## 2. Verificação

- [x] 2.1 Testes unitários do caso de uso (revisão igual, maior e menor) e de integração com o Postgres (reprocessamento fecha o `knowledge` só das redações que mudaram)
- [x] 2.2 Gates locais e `migration-guard` (as retrieval evals rodam no CI; a busca não muda)

## 3. Documentação

- [x] 3.1 ADR 0026 e plano ("Escrita, Blobs, snapshot e promoção")

## 4. Staging

- [x] 4.1 `ingest.yml` depois do merge: os seis Guias EFD ICMS/IPI reprocessados e o `corpus-eval` registrado aqui — run 43264686108: os 6 Guias reprocessados (1.108 redações novas, 7 neurons, embeddings quase todos do cache); `corpus-eval` recall@10 0,875 e MRR 0,596
