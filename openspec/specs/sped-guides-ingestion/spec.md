# sped-guides-ingestion Specification

## Purpose

Define como a ingestão transforma o Guia Prático EFD ICMS/IPI, os leiautes da EFD-REINF, as Notas
Técnicas e o Guia Prático da EFD de Goiás em dispositivos e redações com vigência, com as mesmas
chaves, títulos e rótulos que o golden e as retrieval evals usam.

## Requirements

### Requirement: Registros e campos do Guia Prático

O parser `docling-guia` MUST gerar, a partir do `DoclingDocument`, um dispositivo `registro` por
registro e um `campo` filho por linha da tabela de campos, com a chave, o título, o rótulo e o
`structured` da fixture da F2. O texto do campo SHALL ser a linha da tabela seguida das notas
"Campo NN (…)" dele; o do registro, o título, a descrição e as observações.

#### Scenario: Formato do campo

- **WHEN** o parser lê o campo 07 do registro C170
- **THEN** a chave é `br:efd-icms-ipi:reg:C170:campo:07`, o título `EFD ICMS/IPI > Bloco C > Registro C170 > Campo 07 VL_ITEM`, o rótulo `Guia Prático EFD-ICMS/IPI, Registro C170, Campo 07 (VL_ITEM)` e o `structured` traz número, nome, tipo, tamanho, decimais e as obrigatoriedades de entrada e saída

#### Scenario: Tabela do C170 quebrada entre páginas

- **WHEN** o Docling devolve a tabela de campos do C170 em duas tabelas, a primeira com cabeçalho na página 80 e a segunda sem cabeçalho e com o mesmo número de colunas na página 81
- **THEN** o C170 tem os campos 01 a 38, contíguos, todos com `review_status` `auto`

#### Scenario: Cabeçalho repetido na página seguinte

- **WHEN** a continuação da tabela de campos repete o cabeçalho
- **THEN** as linhas são costuradas na mesma tabela, sem o cabeçalho

#### Scenario: Linha que quebra de página

- **WHEN** a descrição de um campo continua na página seguinte numa linha sem número ou num texto fora da tabela antes de "Observações:"
- **THEN** o texto é juntado ao último campo, e não vira um campo novo

#### Scenario: Documento em várias partes

- **WHEN** o job `extract` divide o Guia por `page_range` e as partes chegam fora de ordem
- **THEN** o parser lê as partes na ordem das páginas

### Requirement: Validação da tabela de campos

Uma tabela de campos MUST ter os campos contíguos de 01 a N, o primeiro campo `REG` e `Tipo` ∈
{C, N}. Quando não tiver, as redações dos campos SHALL sair com `review` (`field-table-invalid`) e
`review_status` `pending`, sem abortar a versão de documento; campo de número repetido SHALL ir
para o log (`skipped`); registro sem tabela de campos SHALL sair com `field-table-missing`.

#### Scenario: Campo fora de sequência

- **WHEN** a tabela de um registro tem os campos 01, 03 e 03
- **THEN** os campos 01 e 03 saem com `review` `field-table-invalid` e o segundo 03 vai para o log como `duplicate-field`

### Requirement: Vigência do Guia por período de leiaute

A redação de um registro ou campo do Guia MUST valer no período de leiaute da versão de documento
(`versionValidDuring`, de `leiaute-periods.yaml`, até o início do período seguinte), e versões
corretivas do mesmo período SHALL receber o mesmo intervalo. A janela de substituição do
`ParsedSource` SHALL ser o período do leiaute.

#### Scenario: Versão corretiva no mesmo período

- **WHEN** as versões 3.1.8 e 3.1.9 do Guia cobrem o leiaute que começa em 2025-01-01 e a seguinte começa em 2026-01-01
- **THEN** as duas valem em `[2025-01-01, 2026-01-01)`

### Requirement: Início declarado de registro ou campo

Um início declarado (tabelas "CAMPOS/REGISTROS INCLUÍDOS NO LEIAUTE A PARTIR DO PERÍODO DE
APURAÇÃO DE …" ou notas "válido/incluído/exigido/obrigatório a partir de …") MUST estreitar o
início da redação. Quando ele cair no fim da vigência do documento ou depois, a redação SHALL
manter a vigência do documento e ir para revisão (`outside-document-validity`).

#### Scenario: Campo incluído no leiaute de 2027

- **WHEN** o Guia 3.2.4 (leiaute desde 2026-01-01) lista o C197 campo 09 entre os campos incluídos a partir de janeiro de 2027
- **THEN** a redação do C197 campo 09 vale a partir de 2027-01-01, sem revisão

#### Scenario: Início depois do fim do documento

- **WHEN** o mesmo campo aparece numa versão do Guia cujo leiaute é `[2025-01-01, 2026-01-01)`
- **THEN** a redação vale em `[2025-01-01, 2026-01-01)` com `review` `outside-document-validity`

#### Scenario: Nota histórica

- **WHEN** uma nota diz "O campo CEST é válido a partir de 01/01/2017" num Guia de leiaute 2026
- **THEN** a vigência do campo continua a do documento

### Requirement: Leiautes da EFD-REINF a partir dos XSD

O parser `reinf-xsd` MUST gerar um dispositivo por evento, por grupo e por campo dos XSD de evento
do pacote de esquemas, com chave `br:efd-reinf:evt:<R-XXXX>[:grupo:<grupo>][:campo:<campo>]`
(grupos aninhados achatados sob o evento, pai no grupo imediato) e `sortPath` com a numeração do
leiaute em PDF. A vigência SHALL ser o período do leiaute (`leiaute_period`).

#### Scenario: Chaves e títulos iguais aos da fixture

- **WHEN** o parser lê os XSD de R-2010, R-4020 e R-4080 da versão 2.1.2
- **THEN** os 170 dispositivos da fixture da F2 existem com o mesmo título, rótulo, `sortPath`, pai e tipo

#### Scenario: Nomes do XSD como publicados

- **WHEN** o R-9001 da 2.1.2 tem o grupo `RTom` e, dentro de `infoCRTom`, o campo `CRTom`
- **THEN** as chaves são `br:efd-reinf:evt:R-9001:grupo:RTom` e `br:efd-reinf:evt:R-9001:grupo:infoCRTom:campo:CRTom`, e todo dispositivo tem o pai presente

#### Scenario: Sufixo da versão no nome do arquivo

- **WHEN** o pacote da 2.1.1 traz `R-9001-evtTotal-v2_01_01-A.xsd`
- **THEN** o arquivo é lido como o XSD do evento R-9001

#### Scenario: Texto a partir do XSD

- **WHEN** o campo `indRetif` do R-4080 tem a restrição `1|2` e a documentação "Indicativo de Retificacao"
- **THEN** o texto é `5 indRetif ideEvento E N 1-1 001 - Indicativo de Retificacao` seguido de `Valores válidos: 1, 2.`

### Requirement: Tópicos do Guia EFD-GO

O parser `docling-generic` MUST abrir um tópico por título `section_header` numerado e ignorar o
sumário e o ruído de página. No Guia EFD-GO, a chave SHALL ser `go:efd-go:item:<tópico>` e a
vigência `[publicação, próxima publicação)` (`publication_approx`).

#### Scenario: Guia EFD-GO 5.9

- **WHEN** o Docling devolve as páginas 26 a 29 do Guia EFD-GO 5.9, publicado em 2026-03-16
- **THEN** os tópicos 1.3, 1.3.1, 1.4, 1.5, 2 e 2.1 viram dispositivos, o 1.3.1 com pai no 1.3, todos válidos a partir de 2026-03-16, com os títulos e rótulos da fixture

### Requirement: Tópicos e vigência das Notas Técnicas

Numa NT, a chave MUST ser `br:<família>:nt:<ano-nnn>:item:<tópico>` e as redações SHALL
seguir a vigência da NT: `optional` em `[optional_from, mandatory_from)`, `mandatory` em
`[mandatory_from, próxima)`, `retroactive` quando o efeito é anterior à publicação
(`legal_effect`).

#### Scenario: Chave da NT

- **WHEN** o tópico 3.1 da NT 2025.001 da EFD ICMS/IPI (`id` `efd-icms-ipi/nt/2025-001`) é lido
- **THEN** a chave é `br:efd-icms-ipi:nt:2025-001:item:3-1`

#### Scenario: NT com período facultativo

- **WHEN** uma NT publicada em 2025-06-01 é facultativa a partir de 2025-07-01 e obrigatória a partir de 2026-01-01, e a próxima versão começa em 2027-01-01
- **THEN** cada tópico tem uma redação `optional` em `[2025-07-01, 2026-01-01)` e uma `mandatory` em `[2026-01-01, 2027-01-01)`

#### Scenario: NT retroativa

- **WHEN** a NT tem efeito em 2025-01-01 e foi publicada em 2025-06-01
- **THEN** as redações saem com `retroactive` verdadeiro

### Requirement: Entrada inválida

Os parsers MUST lançar `ParseError` quando o descritor não trouxer o rótulo, a data ou a vigência
de que a fonte precisa, quando a saída do Docling faltar ou não for um `DoclingDocument` 1.x
válido, quando não houver nenhum registro (Guia), tópico (Guia EFD-GO) ou XSD de evento (REINF), e
quando a família da fonte não for a do parser.

#### Scenario: Docling ausente

- **WHEN** o Guia chega sem nenhuma parte do Docling
- **THEN** o parser lança `ParseError` e nada é gravado
