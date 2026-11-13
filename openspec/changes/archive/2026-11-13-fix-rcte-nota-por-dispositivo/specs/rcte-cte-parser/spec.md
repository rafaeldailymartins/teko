# Spec Delta

## MODIFIED Requirements

### Requirement: Ordem dos parágrafos

A ordem dos parágrafos MUST valer mais que o texto das notas: uma `NotaVigncia` fecha o grupo de
redações superadas imediatamente anterior, e uma nota de alteração abre o primeiro dispositivo
depois dela e os filhos dele, exceto quando a alteração é "ao caput" ou cita outro dispositivo
publicado adiante (requisito "Nota de alteração do dispositivo citado").

#### Scenario: Nova redação do § inteiro

- **WHEN** o § 9º do art. 76 recebe nova redação do Dec. 10.968 com vigência em 28.07.26
- **THEN** o § 9º e os incisos e alíneas novos dele começam em 2026-07-28, e as redações anteriores de 16.04.24 terminam em 2026-07-28

#### Scenario: Retroativo

- **WHEN** a nota diz "ACRESCIDO O § 8º … DECRETO Nº 9.716, DE 22.09.20 - vIGÊNCIA: 01.12.19"
- **THEN** a redação começa em 2019-12-01 com `retroactive: true`

## ADDED Requirements

### Requirement: Nota de alteração do dispositivo citado

Quando a nota de alteração cita um dispositivo abaixo do artigo ("ao INCISO IV", "às alíneas "a" e
"b" do inciso V", "aos incisos IV a VI") e a redação seguinte não é desse dispositivo nem de um
filho dele, a nota SHALL esperar a redação do dispositivo citado, se ela vier antes do próximo
artigo ou título. Sem o dispositivo adiante, ou citando só um artigo, a nota MUST seguir a ordem
dos parágrafos.

#### Scenario: Nota de outro dispositivo no meio

- **WHEN** no art. 12 do RCTE a nota "Conferida nova redação ao INCISO IV do art. 12 … vigência: 05.04.22" vem antes do texto antigo do inciso V, e o texto novo do inciso IV vem depois da nota do inciso V ("… ACRESCIDAS AS ALÍNEAS "A" E "B" AO INCISO V … vigência: 01.05.23")
- **THEN** a redação nova do inciso IV começa em 2022-04-05, a original do inciso V começa em 1998-01-01 sem revisão, e o inciso V novo e as alíneas "a" e "b" dele começam em 2023-05-01

#### Scenario: Citação sem o dispositivo adiante

- **WHEN** a nota cita um inciso que não aparece depois dela no mesmo artigo, ou cita só um artigo ("ACRESCIDO O ART. 181-Q" antes do art. 181-P)
- **THEN** a nota abre a primeira redação depois dela, como antes

### Requirement: Notas de vigência irregulares

O parser MUST ler, sem revisão, as formas irregulares de `NotaVigncia` que a fonte repete: nota
vazia sem lacuna (SHALL virar "sem vigência"), mês com um zero a mais, nota no fim de várias
redações seguidas do mesmo dispositivo com início inline (SHALL valer só para a última) e nota com
o início de uma redação anterior do dispositivo (SHALL valer o início inline). Nota vazia que
abriria uma lacuna MUST continuar em revisão.

#### Scenario: Nota vazia

- **WHEN** o inciso XX do art. 12 do RCTE, acrescido com vigência em 01.05.23, tem "NOTA: Redação com vigência de 01.05.23 a 30.04.23." e a nova redação também começa em 01.05.23
- **THEN** a redação acrescida vai para `skipped` com o motivo `sem-vigencia`, e a nova vale desde 2023-05-01 sem revisão

#### Scenario: Nota vazia com lacuna

- **WHEN** a nota do caput do art. 378 do RCTE diz "de 14.02.22 a 13.02.22" e a redação seguinte só começa em 08.05.23
- **THEN** a redação vai para revisão com o motivo `interval-inverted`

#### Scenario: Várias redações do mesmo dispositivo

- **WHEN** o art. 167-A do RCTE tem as redações "(… vigência: 20.03.07)" e "(… vigência: 01.02.17)" seguidas e depois "Nota: Redação com vigência de 01.02.17 a 31.08.22"
- **THEN** as redações valem `[2007-03-20, 2017-02-01)` e `[2017-02-01, 2022-09-01)`, sem revisão

#### Scenario: Nota com a história do dispositivo

- **WHEN** o inciso IV do art. 401 do RCTE tem as redações de 01.01.01 e de 01.06.13, fechadas por notas inline, e "(… vigência: 22.11.16)" seguida de "NOTA: Redação com vigência de 01.01.01 a 17.11.22."
- **THEN** a última redação vale `[2016-11-22, 2022-11-18)`, sem revisão
