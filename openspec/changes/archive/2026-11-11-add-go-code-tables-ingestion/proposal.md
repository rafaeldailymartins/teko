# Proposal

## Why

As Tabelas 5.1.1, 5.2, 5.3 e 5.5 de Goiás (onda C2) trazem os códigos de ajuste e de informação
adicional que o Guia EFD-GO e as perguntas citam. O WS de Tabelas Externas do SPED publica cada
versão como TXT com as datas de início e fim de cada código; a ingestão precisa transformar isso em
dispositivos e redações com a base `table_declared`, igual à fixture da F2.

## What Changes

- Regras puras das Tabelas de Goiás em `domain/corpus/leiaute-validity.ts` (plano, "Regras de
  vigência", item 5): datas `DDMMAAAA`, linha `[DT_INI, DT_FIM + 1)` com `DT_FIM` vazio = vigente,
  linha vazia descartada e linhas sobrepostas do mesmo código para revisão.
- Parser `sped-tabelas` (`parsers/sped-tabelas.ts`): TXT em cp1252, CRLF, `|`; cada código um
  dispositivo e cada linha uma redação `código - descrição`; a tabela é o dispositivo pai; erro do
  WS (HTTP 200 com texto) vira `ParseError`; SHA-1 conferido com o `hash` dos metadados.
- Fixtures reais em `parsers/__fixtures__/tabelas/`: a Tabela 5.5 (id 40, versão 5) inteira, um
  recorte da 5.3 (id 39, versão 47) e a resposta de erro do WS.
- Fora de escopo: a consulta ao `consultarVersoesTabelasExternas` e o download (frente do
  pipeline), e o fallback em PDF citado no plano.

## Capabilities

### New Capabilities

- `go-code-tables-ingestion`: parser e regras de vigência das Tabelas de Goiás do WS de Tabelas
  Externas.

### Modified Capabilities

Nenhuma.

## Impact

- Código novo em `apps/api/src/adapters/in/cli/ingest/parsers/sped-tabelas.ts` e regras em
  `apps/api/src/domain/corpus/leiaute-validity.ts` (arquivo compartilhado com
  `add-sped-guides-ingestion`).
- O `SourceDescriptor` das tabelas precisa trazer os metadados do WS em `externalTable` (`id`,
  `versao`, `desc`, `dtVersao`, `hash`).
- O `.gitattributes` precisa preservar os bytes cp1252 e CRLF das fixtures TXT.
