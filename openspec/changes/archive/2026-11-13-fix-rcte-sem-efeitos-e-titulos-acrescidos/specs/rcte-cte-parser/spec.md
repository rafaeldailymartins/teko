# Spec Delta

## ADDED Requirements

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
