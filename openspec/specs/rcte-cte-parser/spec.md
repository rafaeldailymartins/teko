# rcte-cte-parser Specification

## Purpose

Define como o Tekó lê o RCTE e o CTE consolidados (HTML da Sefaz-GO) em dispositivos e redações
com vigência meio-aberta, e o que vai para a fila de revisão em vez de virar intervalo adivinhado.

## Requirements

### Requirement: Leitura do HTML consolidado

O parser `go-html-state-machine` MUST decodificar os bytes com `TextDecoder('windows-1252')`
explícito e ler os parágrafos `<p>` em ordem, em streaming, pela classe. Notas editoriais
(`NotaDisc*`, `NotaRev*`) SHALL ser ignoradas sem quebrar o grupo de redações em curso.

#### Scenario: Família errada

- **WHEN** o descritor da fonte não é `rcte` nem `cte`
- **THEN** o parser lança `ParseError`

#### Scenario: Caracteres do cp1252

- **WHEN** um parágrafo traz os bytes 0x93 e 0x94 em volta de uma palavra
- **THEN** o texto sai com as aspas “ e ”

### Requirement: Cabeçalho e recorte

O parser MUST extrair o cabeçalho "CONSOLIDADO ATÉ O DECRETO Nº …" (RCTE) ou "ATUALIZADO ATÉ A
LEI Nº …" (CTE) para `consolidatedUntil`, `versionLabel` e `publishedOn`, devolver
`replacementWindow = {from: null, to: null}` e, no CTE, ler só o Título II do Livro I.

#### Scenario: Cabeçalho do RCTE

- **WHEN** o arquivo traz "CONSOLIDADO ATÉ O DECRETO Nº 10.986, DE 16.09.26."
- **THEN** a versão de documento tem `versionLabel` "RCTE consolidado até o Decreto nº 10.986, de 16.09.26", `publishedOn` 2026-09-16 e `validDuring` `[2026-09-16, null)`

#### Scenario: Recorte do CTE

- **WHEN** o parser lê o CTE.htm
- **THEN** só os parágrafos entre o título "TÍTULO II" e o título "TÍTULO III" viram dispositivos

### Requirement: Intervalo meio-aberto pela nota de vigência

Cada redação MUST ter intervalo `[from, to)` com `from` preenchido e `to: null` para a vigente,
nunca `infinity`. A nota "Redação com vigência de a a b" SHALL fechar a redação em `[a, b + 1)`,
com o ano de 2 dígitos pelo pivô do documento (97 no RCTE, 91 no CTE).

#### Scenario: Golden do art. 76, § 6º

- **WHEN** o parser lê os bytes cp1252 reais dos §§ 5º a 10 do art. 76 do RCTE
- **THEN** o § 6º tem as redações `[2003-09-12, 2004-11-04)` (acréscimo, Dec. 5.825), `[2004-11-04, 2009-11-23)` (nova redação, Dec. 6.026) e `[2009-11-23, null)` (revogação, Dec. 7.028)

#### Scenario: Pivô do CTE

- **WHEN** uma redação do CTE traz "vigência: 15.07.92 a 31.12.95"
- **THEN** o intervalo é `[1992-07-15, 1996-01-01)`

### Requirement: Ordem dos parágrafos

A ordem dos parágrafos MUST valer mais que o texto das notas: uma `NotaVigncia` fecha o grupo de
redações superadas imediatamente anterior, e uma nota de alteração abre o primeiro dispositivo
depois dela e os filhos dele, exceto quando a alteração é "ao caput".

#### Scenario: Nova redação do § inteiro

- **WHEN** o § 9º do art. 76 recebe nova redação do Dec. 10.968 com vigência em 28.07.26
- **THEN** o § 9º e os incisos e alíneas novos dele começam em 2026-07-28, e as redações anteriores de 16.04.24 terminam em 2026-07-28

#### Scenario: Retroativo

- **WHEN** a nota diz "ACRESCIDO O § 8º … DECRETO Nº 9.716, DE 22.09.20 - vIGÊNCIA: 01.12.19"
- **THEN** a redação começa em 2019-12-01 com `retroactive: true`

### Requirement: Sem vigência e exauriu-se

"Redação sem vigência" MUST virar intervalo vazio e ir para `skipped`. "EXAURIU-SE" SHALL começar
a redação seguinte no fim da anterior, ou ir para revisão quando a anterior não tem fim.

#### Scenario: Sem vigência

- **WHEN** a nota diz "Redação sem - vigência em função da alteração retroagir a 01.01.98"
- **THEN** a redação superada vai para `skipped` com o motivo `sem-vigencia`

#### Scenario: Exauriu-se

- **WHEN** o inciso IV do art. 64 do RCTE tem a redação `[2004-11-01, 2005-01-01)` e depois "EXAURIU-SE EM FUNÇÃO DO DECURSO DO PRAZO"
- **THEN** "IV - revogado;" vale a partir de 2005-01-01, sem revisão

### Requirement: Prorrogação e redações idênticas

A prorrogação ("vigência original prorrogada para …") SHALL estender o fim. Redações consecutivas
do mesmo dispositivo com o mesmo texto canônico (`normalizeForHash`) SHALL virar uma só, com o
intervalo alargado.

#### Scenario: Prorrogação do § 3º-A do art. 76

- **WHEN** a nota diz "vigência: 12.07.06 A 31.07.07 (VIGÊNCIA ORIGINAL PRORROGADA PARA 31.07.08 …)"
- **THEN** a redação vale `[2006-07-12, 2008-08-01)`

#### Scenario: Textos iguais em sequência

- **WHEN** duas redações adjacentes diferem só em espaços
- **THEN** sai uma redação com o intervalo das duas

### Requirement: Renumeração

A renumeração SHALL manter uma única chave para a história do dispositivo (a do rótulo atual) e
registrar o rótulo anterior em `labels`.

#### Scenario: Parágrafo único renumerado

- **WHEN** o parágrafo único do art. 59 do RCTE é renumerado para § 1º a partir de 19.05.11
- **THEN** o dispositivo tem a chave `go:rcte:art:59:par:1` e `labels` com "RCTE, art. 59, parágrafo único" até 2011-05-19 e "RCTE, art. 59, § 1º" a partir dessa data

### Requirement: Fila de revisão

O parser MUST marcar `reviewStatus: 'pending'`, com `review.reason` (código estável) e
`review.rawNote`, em vez de adivinhar o intervalo, quando a nota é ilegível, ambígua ou órfã, a
abertura do ato diverge da nota, o estilo é incoerente, falta abertura ou fim, o intervalo é
invertido, há sobreposição com outra redação publicável ou a redação começa antes do pai.

#### Scenario: Estilo trocado

- **WHEN** uma `NovaRedao` (redação vigente) é seguida de um `TextoRevo`
- **THEN** a redação vai para revisão com o motivo `style-mismatch` e o intervalo da `NotaVigncia`

#### Scenario: Data ilegível sem ato próprio

- **WHEN** a nota de um inciso sem nota de alteração própria diz "vigência de 230.09.03 a 20.08.07"
- **THEN** a redação vai para revisão com o motivo `note-date-illegible`, termina em 2007-08-21 e a nota conta em `notesToReview`

### Requirement: Reestruturação do CTE em 1997

No CTE, as redações que terminam até 1997-01-01 (Lei 12.972/96) MUST ir para revisão
(`before-restructuring`), e as que atravessam a data SHALL começar nela.

#### Scenario: CTE antes de 1997

- **WHEN** uma redação do CTE vale de 1992-07-15 a 1995-12-31
- **THEN** ela vai para revisão com o motivo `before-restructuring`

### Requirement: Contagem das notas

O `ParseStats` MUST contar as notas de vigência (parágrafos `NotaVigncia`/`NotaVigor` e notas
inline) com `notesParsed + notesToReview = notesTotal`; uma nota conta como não convertida quando
a redação que ela fecha vai para revisão por causa dela.

#### Scenario: DoD da F3 nos arquivos oficiais

- **WHEN** o parser lê o RCTE.htm e o CTE.htm inteiros
- **THEN** pelo menos 92% das `NotaVigncia` de cada um são convertidas e as demais estão em redações com `reviewStatus: 'pending'`

### Requirement: Identidade igual à da fixture da F2

`stableKey`, `sortPath`, `displayLabel` e `headingPath` MUST seguir o formato da fixture da F2,
com o artigo como pai do caput e filhos por §, inciso, alínea e item.

#### Scenario: Dispositivo do golden

- **WHEN** o parser lê o Título III do RCTE
- **THEN** o § 6º do art. 76 tem a chave `go:rcte:art:76:par:6`, `sortPath` "0076.p06", rótulo "RCTE, art. 76, § 6º" e `headingPath` "RCTE > TÍTULO III - DA COMPENSAÇÃO > CAPÍTULO III - DA APURAÇÃO E DO PAGAMENTO > Seção III - Do Pagamento > Subseção IV - Do Prazo > Art. 76 > § 6º"

### Requirement: Nota de redação sem efeitos

A nota "Redação d… <rótulo> sem efeitos a partir de <data>", em parágrafo de nota ou de texto,
MUST terminar na data a primeira redação ainda sem fim do dispositivo citado; com o período "de a a
b", SHALL tirar `[a, b + 1)` do intervalo dela. A nota MUST NOT virar dispositivo, e a que não casa
com uma redação SHALL ir para a revisão.

#### Scenario: Alíquota do álcool carburante sem efeitos

- **WHEN** o RCTE traz "VIII - 23% … (Redação conferida pelo Decreto nº 9.125 - vigência: 01.01.18)" seguido de "NOTA:Redação do inciso VIII sem efeitos a partir de 23 de junho de 2022"
- **THEN** a redação do art. 20, § 1º, VIII vale `[2018-01-01, 2022-06-23)`, sem revisão

#### Scenario: Período sem efeitos no meio da vigência

- **WHEN** o inciso IX do § 1º do art. 20 do RCTE tem "1. Redação do inciso IX sem efeitos de 23.06.22 a 29.04.23" (em `TextoRevo`) e "2. Redação com vigência de 01.01.16 a 31.05.23"
- **THEN** o inciso tem as versões `[2016-01-01, 2022-06-23)` e `[2023-04-30, 2023-06-01)` com o mesmo texto, e nenhum item 1 é criado

#### Scenario: Depois do marcador de inconstitucionalidade

- **WHEN** a alínea "a" tem uma redação superada aberta desde 2005-04-01, depois "a) Dispositivo declarado inconstitucional por decisão do STF." e a nota "1.Redação da alínea “a” sem efeitos a partir de 23 de junho de 2022"
- **THEN** a redação superada vale `[2005-04-01, 2022-06-23)` sem revisão, e o marcador começa em 2022-06-23, em revisão

### Requirement: Títulos acrescidos

Parágrafos `PargrafoAlterador-titulo` MUST ser lidos como títulos, e os rótulos de Livro, Título,
Capítulo, Seção e Subseção SHALL aceitar sufixo de letra ("CAPÍTULO IV-A", "Subseção XIV-A"). Um
título novo MUST zerar os níveis abaixo dele.

#### Scenario: Capítulo da EFD no RCTE

- **WHEN** depois da Seção XII do Capítulo IV vêm "CAPÍTULO IV-A" e "DA ESCRITURAÇÃO FISCAL DIGITAL - EFD -" em `PargrafoAlterador-titulo` e o art. 356-C
- **THEN** o `headingPath` do art. 356-C é "RCTE > TÍTULO V - DAS OBRIGAÇÕES ACESSÓRIAS > CAPÍTULO IV-A - DA ESCRITURAÇÃO FISCAL DIGITAL - EFD - > Art. 356-C", sem a Seção XII
