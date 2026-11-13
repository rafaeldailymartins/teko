# Design

## Context

O `go-html-state-machine` liga a nota de alteração (`NovaRedao`/`NovaRedRev`) ao primeiro
dispositivo depois dela (ADR 0011). No art. 12 do RCTE, a fonte publica a nota do inciso IV antes
do texto antigo do inciso V, e o texto novo do IV depois da nota do V. A troca leva a vigência do
inciso V para o IV e deixa o IV sem redação vigente de 2022-04-05 a 2023-04-30.

## Decisions

- **Dispositivos citados.** `parseCitedLabels` lê a nota dobrada (sem acento, minúscula), corta o
  ato alterador no primeiro "pelo/pela" (e o "POR FORÇA DO ART. … DO DECRETO" pelo padrão do ato),
  separa o "pelo" grudado no rótulo ("ART. 57pelo") e lê artigo, §, inciso, alínea e item, com
  listas ("I e II", "“A” E “B”") e intervalos ("i a iv"). Depois de "e"/"a", um "o"/"a" seguido de
  outro rótulo é artigo da frase, não alínea. Títulos ("CAPÍTULO IV-A") e subitens ficam de fora.
- **Quando a nota espera.** A redação recebe as notas pendentes que citam o dispositivo dela ou um
  ancestral (basta um nível citado: a nota "AO ITEM 2 …" antes do item 1, erro da fonte, continua
  com o item 1). Se não cita, o parser olha adiante, sem sair do artigo nem passar de um título,
  pela redação de um dispositivo citado cujos níveis foram todos citados com o mesmo rótulo (o
  artigo pode faltar na nota). Achou: a nota fica pendente até ela. Não achou: vale a ordem dos
  parágrafos. Nota que cita só artigo não espera: o RCTE tem "ACRESCIDO O ART. 181-Q" antes do art.
  181-P, e a data é a do 181-P.
- **Notas de vigência irregulares** (padrões repetidos; casos únicos foram para override):
  - mês com zero a mais ("31.010.07", 3 notas do art. 167-J): o mês aceita um zero à esquerda;
  - nota vazia ("de 01.05.23 a 30.04.23", 4 notas): "sem vigência" quando é a primeira redação do
    dispositivo ou a seguinte começa no mesmo dia; com lacuna (art. 378, "14.02.22 a 13.02.22"),
    revisão;
  - várias redações seguidas do mesmo dispositivo, cada uma com início inline, e uma nota no fim
    (arts. 167-A, 213-A-C e 248-J): a nota é da última; as anteriores terminam onde a seguinte
    começa (sem `end-inferred`, porque têm início inline);
  - nota que conta a história do dispositivo (o início é o de uma redação anterior do mesmo
    dispositivo e a redação tem início inline; arts. 213-O, 387 e 401): vale o início inline. Sem
    redação anterior com aquele início (art. 377-B, § 1º), a divergência continua em revisão.
- **Revisão do parser.** `go-html-state-machine` sobe para 3 (ADR 0026).

## Varredura (arquivos de 2026-11-13, parser local, sem banco)

Notas de alteração religadas (`diagnostics.retargetedAmendments`): 5 no RCTE, 0 no CTE.

| Nota                                                          | Passou por            | Ligada a                    |
| ------------------------------------------------------------- | --------------------- | --------------------------- |
| "nova redação ao INCISO IV do art. 12 … vigência: 05.04.22"   | art. 12, V (2 vezes)  | art. 12, IV                 |
| "… ACRESCIDAS AS ALÍNEAS "A" E "B" AO INCISO V … 01.05.23"    | art. 12, IV           | art. 12, V                  |
| "ACRESCIDO O INCISO III AO art. 68 … vigência: 01.04.21"      | art. 68, II           | art. 68, III                |
| "ACRESCIDO O § 16 AO ART. 167-J … vigência: 01.03.22"         | incisos sob o § 15-B  | art. 167-J, § 16 (sem efeito) |
| "§ 16. Nas operações …" (texto em `NovaRedRev`)               | incisos sob o § 15-B  | art. 167-J, § 16 (sem efeito) |

Notas que citam outro dispositivo e não acharam o citado adiante (erros de numeração da fonte,
como "§ 31º", "§ 54º", "§ 16" no lugar do § 17, e parágrafo único já renumerado): 23 notas (25
redações), todas com a ordem dos parágrafos, como antes.

## Medição

| Documento | Dispositivos com vigência mudada | Lacunas publicáveis | `NotaVigncia` em revisão          |
| --------- | -------------------------------- | ------------------- | --------------------------------- |
| RCTE      | 20 (6 da nota por dispositivo)   | 102 → 101 (→ 96 com overrides) | 40 → 27 (→ 9 com overrides) |
| CTE       | 0                                | 7 → 7               | 11 → 11 (→ 1 com overrides)       |

## Risks / Trade-offs

- **Citação errada que casa com outro dispositivo.** Um inciso com o número da nota mais adiante
  no artigo atrairia a nota. O alvo precisa ter todos os níveis citados (inciso I do § 3º não
  responde por "inciso I do caput"), e cada nota religada sai no diagnóstico; nos arquivos atuais,
  as 5 foram conferidas.
- **Art. 68, II.** A nova redação fica sem nota própria (a fonte não a publica) e vai para revisão
  (`opening-missing`), começando no fim da anterior; um override a aprova.
- **Reprocessamento.** No RCTE, 40 das 8.725 redações fecham e 36 entram (0,5%); no CTE, 8 de
  1.681. A fração `pending` cai; nenhum dispositivo some. O disjuntor (ADR 0025) não dispara.

## Context7

Sem biblioteca nova. OpenSpec (`/fission-ai/openspec`): `MODIFIED` substitui o requisito inteiro
e precisa repetir os cenários que continuam.
