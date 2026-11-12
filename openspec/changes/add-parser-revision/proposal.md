# Proposal

## Why

A ingestão trata como `unchanged` toda versão de documento cujo sha256 já foi publicado. Com isso,
uma correção de parser nunca chega a um arquivo já ingerido: no `corpus-eval` de 2026-11-12, o
Guia EFD ICMS/IPI 3.1.9 estava sem o registro 0000 e com os campos do C100 em `pending` (fora da
busca de produção) por dois defeitos do Docling. O parser foi corrigido (#33), mas o mesmo PDF
continuaria `unchanged` no staging, e a produção, que recebe o corpus pelo snapshot do staging,
herdaria o erro.

## What Changes

- Cada parser declara uma revisão (`PARSER_REVISIONS`, em `parsers/index.ts`), incrementada a cada
  mudança que altera a saída para um arquivo já ingerido. O `docling-guia` começa em 2 (a correção
  do #33); os outros, em 1.
- `corpus.document_versions.parser_revision` (inteiro, padrão 1, o que vale para tudo já gravado),
  gravado na publicação e levado no snapshot.
- `IngestDocumentVersion`: `unchanged` só quando o sha256 está publicado com revisão igual ou maior
  que a do parser atual. Com revisão menor, a mesma versão de documento é reprocessada pela
  reconciliação de sempre: redações iguais são reaproveitadas, as que mudaram têm o `knowledge`
  fechado e as corrigidas são inseridas; os embeddings novos passam pelo orçamento e pelo cache.
- O relatório do `load` conta as versões reprocessadas (`reprocessed`).

## Capabilities

### Modified Capabilities

- `embedding-pipeline`: a reingestão sem efeito passa a depender também da revisão do parser.

## Impact

- Migração aditiva (coluna com padrão), sem perda de dados; o `migration-guard` não pede rótulo.
- `apps/api/src/adapters/in/cli/ingest` (`load`, `parsers/index.ts`), `IngestDocumentVersion`, o
  repositório de ingestão, o snapshot (export e promote) e os testes.
- Plano ("Escrita, Blobs, snapshot e promoção") e ADR 0026.
