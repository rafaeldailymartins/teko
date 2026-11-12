# Design

## Context

O pipeline da F3 baixa cada fonte, roda o Docling nos PDFs (job `extract`, `tools/ingest`) e
chama o parser indicado em `corpus/sources.yaml` com os bytes, a saída do Docling e o
`SourceDescriptor` já resolvido (contrato em `parsers/parser.ts`). O parser é uma função pura
que devolve um `ParsedSource` (`domain/corpus/parsed-source.ts`); a reconciliação com o banco é
do `IngestDocumentVersion`. A fixture da F2 (`test/fixtures/corpus/documents/*.json`) foi feita
por curadoria fora do repositório e define as chaves, títulos e rótulos que o golden usa.

## Goals / Non-Goals

**Goals:**

- Chaves estáveis, `headingPath`, `displayLabel`, `sortPath` e `parent` iguais aos da fixture
  da F2 para o Guia EFD ICMS/IPI, a EFD-REINF e o Guia EFD-GO.
- C170 com os campos 01 a N completos mesmo com a tabela quebrada entre páginas (DoD da F3),
  provado com a saída real do Docling.
- Regras de vigência puras, com testes de propriedade, no domínio.

**Non-Goals:**

- Reproduzir byte a byte o texto da fixture: a curadoria usou pypdfium2 (aspas tipográficas,
  quebras de linha do PDF) e o Docling normaliza aspas e traços; o `content_hash` difere e a
  primeira ingestão real fecha o `knowledge` das linhas da fixture no staging (é o esperado).
- Diferenças entre versões do mesmo Guia (o `IngestDocumentVersion` reconcilia por `stable_key`
  e `content_hash`).

## Decisions

- **Leitura do DoclingDocument pela árvore `body`.** A ordem de leitura vem dos `$ref` do `body`
  (busca em profundidade, incluindo filhos de grupos e legendas de tabelas), e não da ordem de
  `texts`. Itens `furniture` e rótulos `page_header`/`page_footer` saem. Figuras (`pictures`)
  saem com os filhos: sem OCR, os filhos são rótulos soltos de fluxogramas (Guias EFD-GO, NTs
  2023-001 e 2026-001), ruído fora da imagem; o primeiro run real (2026-11-12) parou nelas porque o
  leitor recusava `#/pictures/N`. A grade das tabelas é
  remontada de `table_cells` (a `grid` é campo calculado do `TableData`); célula mesclada fica só
  na primeira posição, para não duplicar texto. Documentos em várias partes (`page_range`) são
  ordenados pela menor página de cada parte (o Docling mantém o número da página original).
- **Segmentação do Guia por registro.** Um texto que começa com `REGISTRO XXXX` abre o registro
  (qualquer rótulo: o Docling às vezes classifica o título como `text`). Fases: descrição →
  tabela de campos → "Observações:" → notas "Campo NN". Texto fora da tabela entre a tabela e as
  observações continua a última linha (é o caso real do C197 campo 09, cuja descrição quebra de
  página e vira `list_item`); a fixture da F2 fez o mesmo.
- **Costura de tabelas.** Na fase de campos, tabela com o cabeçalho repetido é costurada (sem o
  cabeçalho); sem cabeçalho, só com o mesmo `num_cols`. Linha sem número continua a anterior
  (célula a célula). Outras tabelas (códigos dentro das notas) viram texto da seção corrente.
- **Validação → revisão, não erro.** Tabela que falha (01..N contíguos, primeiro `REG`, `Tipo` ∈
  {C, N}) gera as redações com `review: field-table-invalid` (o `IngestDocumentVersion` manda para
  a fila); campo repetido vai para `skipped`; registro sem tabela fica com
  `field-table-missing`. `ParseError` só para entrada impossível (descritor incompleto, Docling
  inválido, nenhum registro).
- **Estreitamento pelo início declarado.** Duas fontes no próprio Guia: as tabelas "CAMPOS
  INCLUÍDOS / REGISTROS INCLUÍDOS NO LEIAUTE A PARTIR DO PERÍODO DE APURAÇÃO DE <mês> DE <ano>"
  do Capítulo I (é de lá que vêm o 1310 campo 11 em 2026 e o C197 campo 09 em 2027 da fixture) e
  notas "válido/incluído/exigido/obrigatório a partir de <data>". Só esses verbos contam: "A
  partir de 01/01/2018: Valores válidos…" descreve mudança de regra, não o início do campo. Início
  até o começo do documento é histórico e não muda nada; início no fim do documento ou depois
  mantém a vigência do documento e vai para revisão (`outside-document-validity`).
- **Tópicos do Guia EFD-GO e das NTs.** Só `section_header`/`title` numerados abrem tópico;
  sumário (`document_index` e linhas com pontilhado), linhas de sublinhado, rodapés mal
  classificados ("ECONOMIA/GO - 27 -") e o título corrente do Guia EFD-GO saem. Tópico repetido
  (anexos que reiniciam a numeração) vai para `skipped`. O pai é o ancestral numerado mais
  próximo presente no documento (a fixture não tinha o tópico 1, por isso o 1.3 lá não tem pai).
- **Chave das NTs.** Segmento novo `nt` na gramática da `stable_key` (`provision-id.ts`), com
  valor `ano-nnn` (`^\d{4}-\d{3}$`): `br:<família>:nt:<ano-nnn>:item:<tópico>`, ex.
  `br:efd-icms-ipi:nt:2025-001:item:3-1`. Tópicos de NTs diferentes nunca colidem. O valor sai do
  último segmento de `source.id`, em `ano-n`/`ano.n` (`2025-001`, `2025.1`) ou `n-ano`/`n/ano`
  (`05-2026` → `2026-005`, como as NTs da REINF). Entrou antes de qualquer NT ser ingerida, porque
  a chave é imutável. Alternativa descartada: reaproveitar `sec:<dígitos>`, que confundiria NT
  com seção de lei.
- **Vigência das NTs.** `ntValidity` gera até duas redações por tópico (`optional` e
  `mandatory`) com o mesmo texto; a "próxima" é o fim de `versionValidDuring` quando houver.
  `retroactive` quando o efeito é anterior à publicação. NT cuja obrigatoriedade ficaria vazia vai
  para revisão (`nt-empty-mandatory`).
- **REINF pelo XSD.** `htmlparser2` em `xmlMode` monta a árvore e o parser percorre
  `xs:element`/`xs:attribute` atravessando `sequence`/`choice`/`all` e tipos globais nomeados. A
  numeração segue o leiaute em PDF (`Reinf` = 1, evento = 2, `id` = 3, depois em profundidade, com
  os atributos logo depois do seu elemento): bate com os 170 `sortPath` da fixture. Grupos
  aninhados ficam achatados sob o evento na chave e no título (só o grupo imediato), com `parent`
  no grupo imediato, como na fixture. O título do evento vem de uma tabela (`EVENT_TITLES`),
  porque o XSD só tem a documentação sem acentos.
- **Nomes do XSD na chave.** Grupos e campos usam o nome do elemento como o pacote oficial grafa.
  O primeiro run real no staging (2026-11-12) mostrou nomes com maiúscula inicial e sublinhado
  (`RTom`, `CRTom`, `infoCR_CNR`, nos totalizadores R-9001, R-9011 e R-9015), que a gramática
  original de `grupo` e `campo` (`[a-z][A-Za-z0-9]*`) recusava: 84 elementos iam para o log e os
  filhos ficavam sem pai, o que o gravador recusa. A gramática passou a `[A-Za-z][A-Za-z0-9_]*`,
  antes de qualquer chave da REINF ser gravada. O nome do arquivo também varia: `-v2_01_02d.xsd`
  na 2.1.2 e `-v2_01_01-A.xsd` na 2.1.1.
- **Texto da REINF.** O XSD não tem a descrição, as validações nem as condições do PDF de
  leiautes. O texto é montado com as colunas derivadas do XSD (pai, elemento, tipo, ocorrência,
  tamanho, decimais), a `xs:documentation` e os valores válidos (enumeração ou padrão `1|2`).
  Tipo e tamanho batem com a fixture em 142 de 152 campos (o XSD não distingue C de N em textos
  só de dígitos, como CNPJ). Proposta de saída para recuperar a descrição do PDF sem perder a
  estrutura do XSD: o pacote de leiautes traz o PDF; com a saída do Docling dele em
  `ParserInput.docling`, o parser pode casar as linhas da tabela do leiaute por `(número, nome)` e
  usar a descrição do PDF no texto. Fica registrado aqui; o parser atual não depende do Docling.

## Risks / Trade-offs

- **Número da NT no `id` da fonte.** O `corpus/sources.yaml` precisa nomear as NTs com o número
  (`…/nt/2025-001`); um `id` sem ele vira `ParseError`.
- **Títulos REINF fora da fixture.** Os títulos de R-1000…R-9000 além de R-2010, R-4020 e R-4080
  vêm do sumário dos leiautes e não foram conferidos por teste.
- **Rótulos do Docling.** A detecção de registro e de tópico depende de o Docling classificar o
  título como `section_header` (tópico) ou de o texto começar por `REGISTRO` (Guia). As fixtures
  reais cobrem os casos observados (título como `caption`, `list_item` de continuação, rodapé
  como `text`).
- **Fixture da F2 com o C197 campo 09 incompleto.** A curadoria guardou só número e nome em
  `structured`; o parser traz tipo, tamanho, decimais e obrigatoriedades.

## Fixtures

- `parsers/__fixtures__/guia/guia-3-2-4-p{017-018,080-081,109-111}.docling.json`: saída real do
  Docling 2.146.0 (TableFormer V1 `ACCURATE`, `do_cell_matching`, sem OCR, as opções do
  `tools/ingest`) para o Guia 3.2.4 (sha256 `01e76f…f164`), por `page_range`. Recorte: sem a
  `grid` (calculada), sem o `bbox` das células (opcional no `TableCell`), coordenadas com 2 casas
  e `binary_hash` zerado. As páginas 80–81 têm o C170 quebrado; 109–111, o C197 com a linha 09
  quebrada; 17–18, as tabelas de campos incluídos por ano.
- `parsers/__fixtures__/efd-go/guia-go-5-9-p{003,026-029}.docling.json`: Guia EFD-GO 5.9 (sha256
  `625f04…65c1`), sumário e tópicos 1.3 a 2.1, mesmo recorte.
- `parsers/__fixtures__/reinf/`: XSD de R-2010, R-4020 e R-4080 do "Pacote XSD Eventos EFD Reinf
  v 2.1.2" (`xsd-eventos`, zip sha256 `6e4076…49f1`), bytes como publicados (CRLF).
- NTs: `DoclingDocument` sintético nos testes, com os campos que o `save_as_json` grava (não há
  NT na fixture da F2).

## Fontes Context7

| Biblioteca   | ID Context7                     | Versão conferida | Tópicos                                                                                                                                     |
| ------------ | ------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| docling-core | `/docling-project/docling-core` | 2.105.0          | `DoclingDocument` (`body`, `texts`, `groups`, `tables`, `$ref`), `TableData.table_cells` e `grid` calculada, `prov.page_no`, `save_as_json` |
| Docling      | `/docling-project/docling`      | 2.146.0          | `DocumentConverter.convert(page_range=…)` (páginas a partir de 1, número original preservado)                                               |
| htmlparser2  | `/fb55/htmlparser2`             | 12.0.0           | `Parser` com `xmlMode` (nomes com prefixo `xs:` preservados, sem lowercase), `onopentag`/`ontext`/`onclosetag`                              |
