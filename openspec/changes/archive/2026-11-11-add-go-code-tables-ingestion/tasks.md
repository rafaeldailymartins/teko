# Tasks

## 1. Domínio

- [x] 1.1 Regras das Tabelas de Goiás em `domain/corpus/leiaute-validity.ts` (`parseDdMmAaaa`, `tableRowInterval`, `overlappingRowIndexes`), com a propriedade da conversão de intervalo inclusivo para meio-aberto — `vitest run --project unit src/domain/corpus/leiaute-validity.test.ts`

## 2. Parser

- [x] 2.1 `parsers/sped-tabelas.ts`: TXT cp1252, código e linhas, tabela pai, `externalTable` validado com zod, SHA-1, erro do WS
- [x] 2.2 Fixtures reais: Tabela 5.5 v5 inteira, recorte da 5.3 v47 e a resposta de erro; a 5.5 reproduz a fixture da F2 — `vitest run --project unit src/adapters/in/cli/ingest/parsers/sped-tabelas.test.ts`

## 3. Integração

- [x] 3.1 `.gitattributes` com `-text` para as fixtures TXT (arquivo fora da frente: aplicado pelo orquestrador)
- [x] 3.2 `externalTable` no `SourceDescriptor` e preenchimento pelo pipeline a partir do `consultarVersoesTabelasExternas` (frente do pipeline)
