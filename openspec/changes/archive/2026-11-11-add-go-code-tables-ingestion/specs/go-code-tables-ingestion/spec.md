# Spec Delta

## Purpose

Define como a ingestão transforma as Tabelas de Goiás do WS de Tabelas Externas do SPED em
dispositivos e redações com as datas declaradas em cada código.

## ADDED Requirements

### Requirement: Um dispositivo por código e uma redação por linha

O parser `sped-tabelas` MUST ler o TXT em cp1252 e gerar o dispositivo `tabela`
(`go:tabelas-go:tab:<n-n>`) e, para cada código, um dispositivo `codigo`
(`go:tabelas-go:tab:<n-n>:cod:<código>`, título `Tabelas da EFD ICMS/IPI de Goiás > Tabela <n.n> >
<código>`, rótulo `Tabela <n.n> (GO), código <código>`) com uma redação por linha do TXT, de texto
`<código> - <descrição>` e vigência `[DT_INI, DT_FIM + 1)`, `DT_FIM` vazio = vigente, base
`table_declared`.

#### Scenario: Tabela 5.5 versão 5

- **WHEN** o parser lê o TXT da Tabela 5.5 (id 40, versão 5) com os metadados do WS
- **THEN** o resultado é igual, dispositivo a dispositivo, à fixture `tabela-go-5-5` da F2

#### Scenario: Código com duas linhas

- **WHEN** o código GO00009036 da Tabela 5.3 tem uma linha de 01012016 a 30092020 e outra desde 01102020 sem fim
- **THEN** o dispositivo tem as redações `[2016-01-01, 2020-10-01)` e `[2020-10-01, ∞)`

### Requirement: Linhas anômalas

Uma linha com data inválida, com `DT_FIM` anterior a `DT_INI`, com menos de quatro campos ou com
código fora da gramática da `stable_key` MUST ir para o log (`skipped`) sem impedir a publicação
das demais. Linhas do mesmo código com intervalos sobrepostos SHALL sair, a partir da segunda, com
`review` `overlapping-rows` e `review_status` `pending`.

#### Scenario: Sobreposição

- **WHEN** o código GO01 tem uma linha de 2009 a 2019 e outra desde 2015
- **THEN** a primeira sai `auto` e a segunda `pending` com `overlapping-rows`

### Requirement: Metadados e integridade da versão

A versão de documento MUST vir dos metadados do `consultarVersoesTabelasExternas` entregues em
`source.externalTable` (rótulo `Tabela <n.n> (GO), versão <v> de <dd/mm/aaaa>`, `publishedOn` =
`dtVersao`), com janela de substituição de todo o tempo. O parser SHALL lançar `ParseError` sem
os metadados, com `versão=N` diferente da dos metadados, com SHA-1 diferente do `hash` ou quando
a resposta não for uma tabela.

#### Scenario: Erro do WS com HTTP 200

- **WHEN** o WS responde `Erro o obter Tabela:VERSAO_TABELA_EXTERNA_NAO_ENCONTRADA.` com HTTP 200
- **THEN** o parser lança `ParseError` com o texto do erro e nada é gravado

#### Scenario: Arquivo diferente do publicado

- **WHEN** o SHA-1 do TXT baixado não é o `hash` do metadado
- **THEN** o parser lança `ParseError`
