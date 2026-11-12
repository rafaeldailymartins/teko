# Spec Delta

## Purpose

Define como o Tekó extrai os documentos PDF e XLSX do corpus com o Docling, inteiros ou por
partes, sem segredos e com um manifesto que o pipeline Node consegue conferir.

## ADDED Requirements

### Requirement: Conversão por partes

O `teko-ingest convert` MUST aceitar `--page-range <início>-<fim>` (páginas com base 1,
inclusivas) e converter só essas páginas; a saída SHALL ficar em `<sha256>-p<início>-<fim>/` e o
manifesto SHALL registrar `page_range` e `part`, ambos `null` quando o documento é convertido
inteiro.

#### Scenario: Parte de um Guia longo

- **WHEN** o Guia 3.2.4 é convertido com `--page-range 121-240`
- **THEN** a saída fica em `<sha256>-p121-240/docling.json` e o manifesto traz `page_range: [121, 240]` e `part: "p121-240"`

#### Scenario: Intervalo inválido

- **WHEN** o `--page-range` é `0-5` ou `9-3`
- **THEN** a CLI termina com o código 2 sem chamar o Docling

### Requirement: Só PDF e XLSX

A conversão MUST aceitar só arquivos `.pdf` e `.xlsx` e SHALL recusar qualquer outro formato antes
de calcular o hash ou carregar o Docling, com o código de saída 2.

#### Scenario: Planilha da REINF

- **WHEN** um `.xlsx` da EFD-REINF é convertido
- **THEN** o conversor usa o backend de Excel do Docling e grava `docling.json` e `manifest.json`

#### Scenario: Formato inesperado

- **WHEN** o arquivo recebido é um `.docx`
- **THEN** a CLI termina com o código 2 e não grava saída

### Requirement: Manifesto coerente

O leitor do manifesto MUST recusar `part` incoerente com `page_range` e intervalos com início
menor que 1 ou fim antes do início, e SHALL aceitar manifestos sem esses campos como documento
inteiro.

#### Scenario: Parte trocada

- **WHEN** um manifesto traz `page_range: [1, 120]` e `part: "p1-121"`
- **THEN** a leitura falha com erro de manifesto
