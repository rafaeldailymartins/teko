# Design

## Context

O `go-html-state-machine` lê o RCTE e o CTE parágrafo a parágrafo pela classe (ADR 0011). As
notas editoriais (`NotaDisc*`, `NotaRev*`) são transparentes, e os títulos vêm de `TitCentral` ou
de parágrafos de texto com cara de título. Duas coisas escaparam: a NOTA que tira o efeito de uma
redação sem revogá-la (LC 194/2022, combustíveis, energia e comunicação) e a classe
`PargrafoAlterador-titulo`, usada nos títulos acrescidos por ato posterior.

## Variantes encontradas (arquivos de 2026-11-13)

Busca por "sem efeito" (com e sem "s"), "a partir de", "desde", "suspens", "não se aplica" e
"sem aplicabilidade" no texto dobrado dos dois arquivos:

| Forma                                                                  | Classe       | RCTE | CTE |
| ---------------------------------------------------------------------- | ------------ | ---- | --- |
| "1.Redação da alínea “a” sem efeitos a partir de 23 de junho de 2022"  | `NotaDisc3`  | 3    | 3   |
| "NOTA:Redação do inciso VIII sem efeitos a partir de … sendo que, …"   | `NotaDisc1`  | 2    | 2   |
| "1. Redação do inciso XII sem efeitos a partir de …" (antes da NOTA 2) | `NotaDisc1`  | 0    | 1   |
| "1. Redação do inciso IX sem efeitos de 23.06.22 a 29.04.23 …"         | `TextoRevo`  | 1    | 0   |

Ficam de fora, de propósito: "sem efeito suspensivo" e "torna-se sem efeito" (texto de lei);
"Redação sem - vigência" (já tratada como `sem-vigencia`); "encontrava-se sem aplicabilidade, até
a entrada em vigor da LC 190/2022" (sem data); "Suspensa a aplicação do disposto nesta alínea"
(sem data); e "Em função da LC 194, não se aplica o disposto no § 6º às operações … com gasolina,
óleo diesel e energia elétrica a partir de 23 de junho de 2022" (atinge só parte do parágrafo; o
texto continua valendo para as demais operações).

## Decisions

- **Reconhecimento pelo texto, não pela classe.** A nota vem em `NotaDisc1`, `NotaDisc3` e, por
  erro da fonte, em `TextoRevo`. O padrão exige o início "Redação d… <rótulo> sem efeito(s)"
  (depois do prefixo "NOTA:"/"1."), que texto de lei não tem. Datas numéricas ou por extenso
  ("23 de junho de 2022", "1º de janeiro de 2024").
- **Qual redação.** O rótulo citado ("alínea a", "inciso VIII", "item 1") é lido na estrutura
  corrente. Entre as redações desse dispositivo publicadas depois da última redação do pai, vale a
  primeira ainda sem fim declarado. A nota vem depois da redação vigente; quando a vigente é o
  marcador "dispositivo declarado inconstitucional por decisão do STF" (sem abertura), a redação
  atingida é a superada que ficou aberta antes dele. Sem redação que case, a nota vai para revisão
  (`note-orphan`); data ilegível, `note-unparsed`; segunda nota para a mesma redação,
  `note-ambiguous`.
- **Fim, não revogação.** "A partir de a" termina a redação em `a` (`[from, a)`), sem redação
  seguinte: no período, o dispositivo não tem texto em vigor (a alíquota de 14,17% do etanol vem de
  outro ato). "De a a b" tira `[a, b + 1)` do intervalo: a redação vira duas versões com o mesmo
  texto, e a lacuna impede a fusão de redações iguais. Com nota de vigência e nota "sem efeitos",
  vale o fim mais cedo. Se a redação começou depois de perder o efeito, nada sobra: o intervalo
  fica e vai para revisão. O marcador "declarado inconstitucional" continua `pending`
  (`opening-missing`), agora a partir do fim da redação anterior. Filhos do dispositivo citado não
  herdam o corte (no corpus atual, todas as notas atingem folhas).
- **Contagem à parte.** As notas "sem efeitos" ficam em `diagnostics.withoutEffectNotes`, fora do
  `ParseStats`, que continua medindo as notas de vigência (DoD da F3).
- **"NOTAS:" em `TextoRevo`.** O cabeçalho da lista de notas é editorial; antes, virava a última
  linha do texto do inciso IX.
- **Títulos acrescidos.** `PargrafoAlterador-titulo` tem o papel de `TitCentral`: rótulo e nome
  numa sequência, com `setHeading` zerando os níveis de baixo (capítulo novo não herda seção nem
  subseção). As expressões de nível já aceitavam o sufixo de letra ("Seção I-A", "Subseção
  XIV-A", "CAPÍTULO VII-A"); faltava a classe. O nome novo de um título renomeado depois da nota
  da redação anterior continua de fora, como na fixture da F2 (RCTE, Capítulo V do ITCD; CTE,
  Seção III do Capítulo III).
- **Título na identidade da reconciliação.** O `headingPath` está nos chunks (texto do embedding e
  `tsv`). O `lockOpenVersions` passa a ler o `heading_path` do chunk de ordinal 0 (subconsulta
  correlata; o `FOR UPDATE OF pv` trava só as redações), e título diferente não reaproveita a
  linha. Redação sem chunk (`null`) casa por texto, como antes.
- **Revisão do parser.** `go-html-state-machine` sobe para 2 (ADR 0026).

## Medição (arquivos de 2026-11-13, parser local, sem banco)

| Documento | Dispositivos com vigência mudada | Itens falsos removidos | `headingPath` mudado          | `NotaVigncia` em revisão |
| --------- | -------------------------------- | ---------------------- | ----------------------------- | ------------------------ |
| RCTE      | 6 (9 redações saem)              | 1                      | 717 dispositivos (820 redações) | 40 → 40                |
| CTE       | 6 (9 redações saem)              | 0                      | 4 dispositivos (4 redações)   | 11 → 11                  |

As redações `pending` caem 3 em cada documento (as superadas sem fim que a nota fecha).

## Risks / Trade-offs

- **Reprocessamento.** No RCTE, cerca de 830 das ~8.700 redações abertas fecham e reentram (9,5%),
  abaixo do limite de 20% do disjuntor; a fração `pending` cai e nenhum dispositivo perde redação
  aberta, exceto o item falso. O `--accept-churn` não deve ser necessário. Os chunks dessas
  redações são embutidos de novo (título novo no texto do embedding).
- **Heurística da redação atingida.** Depende da ordem dos parágrafos: uma nota fora do lugar pode
  atingir outra redação aberta do mesmo rótulo; sem nenhuma, vai para a revisão. Nas 12 notas
  atuais, a redação escolhida foi conferida uma a uma.

## Context7

| Biblioteca  | ID                     | Consulta                                                                 |
| ----------- | ---------------------- | ------------------------------------------------------------------------ |
| PostgreSQL  | `/websites/postgresql` | `FOR UPDATE OF` com tabela nomeada trava só as linhas dela; subconsulta lê |
