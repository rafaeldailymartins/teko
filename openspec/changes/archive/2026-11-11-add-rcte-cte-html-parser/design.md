# Design

## Context

O contrato da saída dos parsers (`ParsedSource` em `domain/corpus/parsed-source.ts`) e o do
parser (`Parser` em `adapters/in/cli/ingest/parsers/parser.ts`) já estão gravados. A fixture da
F2 (`apps/api/test/fixtures/corpus/documents/{rcte,cte}.json`) foi curada fora do repositório com
uma máquina de estados de curadoria e omitiu os casos ambíguos; o parser da F3 lê os arquivos
oficiais inteiros e precisa produzir as mesmas chaves e rótulos, mandando para revisão o que a
curadoria omitiu. O domínio só importa `zod` e `@teko/shared`; o `htmlparser2` fica no adapter.

Arquivos oficiais medidos (baixados em 2026-11-11, User-Agent do `corpus-watch`, fora do
repositório): RCTE.htm 9.943.888 bytes, sha256 `e058bc68…cd2a`, "CONSOLIDADO ATÉ O DECRETO Nº
10.986, DE 16.09.26" (o mesmo cabeçalho da fixture, com bytes diferentes do sha256 da F2); CTE.htm
2.005.477 bytes, sha256 `8a8aee52…f54a`, "ATUALIZADO ATÉ A LEI Nº 24.608 DE 06.11.26" (a fixture
é da Lei 24.391).

## Goals / Non-Goals

**Goals:**

- ≥ 92% das `NotaVigncia` convertidas e 100% do restante na fila de revisão (DoD da F3).
- Golden do art. 76 com os intervalos da tabela do plano, com bytes cp1252 reais.
- Chaves, `sortPath`, `displayLabel` e `headingPath` no formato da fixture da F2.

**Non-Goals:**

- Ler os Anexos VIII e IX (onda C3) e o `Decretos_Atualizadores.htm` (as datas dos atos citados
  só nas notas inline continuam sem `actDate`).
- Resolver as anomalias: a fila de revisão e os overrides (`corpus/overrides/`) fazem isso.

## Decisions

### Divisão domínio × adapter

`validity.ts` (domínio) lê o texto das notas e monta a linha do tempo de um dispositivo a partir
das evidências que o parser junta (`VersionCandidate`: abertura do ato próprio ou herdada, nota
de vigência, nota inline, bloco do pai, marcas do parser). O adapter cuida do HTML, da estrutura
(artigo > § > inciso > alínea > item), dos títulos e da renumeração. Assim as regras do plano
("Regras de vigência", item 3) têm testes de propriedade sem HTML.

### Máquina de estados

- **Grupo aberto.** Uma `NotaVigncia` fecha a sequência de redações da mesma classe logo antes
  dela (as que ainda não se fecharam com nota inline ou nota própria). Uma `ParNormal` no meio
  quebra a sequência; notas editoriais não. Alternativa descartada: fechar tudo desde a última
  nota, que fazia uma nota de 2018 fechar a alínea "c" de 2007 do art. 20.
- **Abertura herdada.** A nota de alteração vale para o primeiro dispositivo depois dela e para
  os filhos dele enquanto a estrutura continua dentro dele, nunca numa "nova redação ao caput".
  Um filho que já tinha redação publicada depois da nota do pai não herda (a redação nova dele
  precisa de nota própria; sem ela, `opening-missing`). A nota de renumeração antes de uma redação
  superada ("O § 1º vigorou como parágrafo único até…") não dá abertura àquele texto.
- **Bloco do pai.** Filho superado sem nota própria fecha com o intervalo da redação superada do
  pai que o antecede (§ 2º do art. 76: incisos I a III de 1998-12-17 a 2008-10-01), como na
  curadoria. Superada sem nota e sem bloco: fim = início da redação seguinte; sem revisão só
  quando a nota inline trouxe só o início (caso previsto no plano), senão `end-inferred`.
- **Precedência das datas.** Início: nota de vigência > inline > ato próprio > bloco do pai (só
  na primeira redação) > fim da anterior (com revisão) > redação original (RCTE 1998-01-01, CTE
  1992-03-01, sobrescrevível por `effective_from` do `sources.yaml`). Ato próprio divergente da
  nota vence com `opening-mismatch` (a nota costuma errar por um dia, como no inciso V do art. 64:
  "08.06.04" contra a abertura de 09.06.04), exceto com estilo incoerente, em que a nota de
  alteração pode ser de outro dispositivo. Início ilegível com fim legível e ato próprio ("230.09.03
  a 20.08.07", § 5º, I, do art. 76) vale o ato, sem revisão, como na fixture.
- **Estilo incoerente.** `NovaRedao` antes de `TextoRevo` (ou `NovaRedRev` antes de `ParNormal`)
  e `NotaVigncia` fechando redação vigente vão para revisão (`style-mismatch`).
- **Títulos.** `TitCentral` com rótulo (Livro, Título, Capítulo, Seção, Subseção) e o título logo
  depois ("TÍTULO III - DA COMPENSAÇÃO"); título com outros parágrafos no meio fica de fora ("Seção
  III" do CTE, como na fixture). O `headingPath` usa os títulos do lugar da redação vigente do
  artigo (no CTE, as redações anteriores a 1997 ficam num bloco com a estrutura antiga) e não leva
  o Livro.
- **Rótulos.** `§` sempre com "º" ("§ 10º", formato da fixture); artigo com "º" só até 9. Item
  "2-A" vira `item:2-1` e alínea "c-a" vira `ali:c-1` (a gramática da chave só aceita números no
  sufixo); "2.1." é texto do item 2, como na fixture.
- **Rótulos fora da gramática.** "Art. 167-S-B" (38 artigos do RCTE) não cabe em
  `art: \d{1,4}(-[A-Z])?`. O rascunho ganha uma chave provisória, as notas dele seguem contando, e
  as redações vão para `skipped` (`chave-invalida`). Quando `provision-id.ts` aceitar o segundo
  sufixo, elas viram dispositivos sem mudar o parser.

### Renumeração: uma chave, a do rótulo atual

As redações superadas publicadas com o rótulo antigo (depois da última vigente com esse rótulo)
passam para a chave do rótulo atual, e `labels` registra o rótulo antigo até a data da
renumeração. Alternativa: manter a chave do rótulo original. Descartada porque (a) a fixture da
F2 e o golden usam o rótulo atual (`go:rcte:art:76:par:1`); (b) com renumerações de inciso ("XVI
para XVIII" no CTE), o rótulo antigo pode ser reutilizado por um dispositivo novo e as chaves
colidiriam; (c) o braço de referência da busca extrai a chave do rótulo citado, que é o atual.
Consequência: uma renumeração futura numa nova consolidação muda a chave (o `knowledge` das linhas
antigas fecha e as novas entram), o que difere da letra do comentário de `provision-id.ts`
("nunca a chave"); dentro de uma versão de documento a chave é única para a história toda.

### CTE e a reestruturação de 1997

A Lei 12.972/96 deu nova redação aos arts. 44 a 63 (e a outros) com vigência em 01.01.97, e vários
números passaram a ter outro conteúdo (o art. 44 antigo tratava de benefícios fiscais). Detectar
"o número trocou de conteúdo" por texto seria adivinhar. Regra: redações que terminam até
1997-01-01 vão para revisão (`before-restructuring`, visíveis no staging, fora da produção);
redações que atravessam a data começam nela (o trecho anterior fica em `skipped`,
`antes-da-reestruturacao`). Assim a cobertura do CTE continua a partir de 1997-01-01, como na
fixture, e um override pode reabilitar uma redação antiga quando o mantenedor confirmar que o
número não mudou de conteúdo. O bloco com a estrutura anterior que precede o título "TÍTULO II"
fica fora do recorte.

### Contagem das notas

`stats` conta `NotaVigncia`/`NotaVigor` e notas inline. Uma nota conta como não convertida quando
a redação que ela fecha vai para revisão por causa dela (nota ilegível, ambígua, órfã, abertura
divergente, intervalo invertido); revisões por outro motivo (estilo, sobreposição, pai,
reestruturação) não a contam. `parseConsolidatedWithDiagnostics` separa as `NotaVigncia` (a
métrica do DoD) das inline e conta as notas de títulos, os parágrafos sem dispositivo e os
rótulos fora da gramática.

## Medição do DoD (arquivos oficiais de 2026-11-11, fora do CI)

| Documento | `NotaVigncia` convertidas | Inline convertidas | Dispositivos | Redações | Em revisão | `skipped` |
| --------- | ------------------------- | ------------------ | ------------ | -------- | ---------- | --------- |
| RCTE      | 881 de 920 (95,8%)        | 1.756 de 1.776     | 6.831        | 8.366    | 275        | 20 sem vigência, 362 chave inválida |
| CTE       | 310 de 321 (96,6%)        | 169 de 169         | 1.275        | 1.681    | 281 (198 antes de 1997) | 18 sem vigência, 320 cortes em 1997 |

Tempo: ~0,7 s (RCTE) e ~0,2 s (CTE). Os recortes versionados (`titulos-iii-e-iv.htm.gz`, 81 KB;
`titulo-ii.htm.gz`, 116 KB) dão a mesma taxa e entram no teste unitário.

### Comparação com a fixture da F2

RCTE (arts. 44–87): 723 das 750 redações da fixture saem com o mesmo intervalo. CTE (Título II):
279 de 297. Diferenças por categoria:

- **O parser manda para revisão o que a curadoria omitiu** (as categorias do README da fixture):
  versões antes do pai, abertura divergente, nota ambígua ("31.08.01(energia elétrica) e
  30.09.01(...)"), vigente sem abertura depois de superada, superada sem fim.
- **Merge de idênticas** (plano): a alínea "b" do inciso I do art. 56 tinha duas redações com o
  mesmo texto em sequência; o parser as funde em `[1998-01-01, 2009-12-29)`.
- **Abertura herdada de nova redação do artigo inteiro** (art. 52 do RCTE em 2009, art. 56 em
  1998, art. 74-A em 2010): a fixture deu a data original a filhos criados pela nova redação; o
  parser dá a data do ato. Idem os incisos do § 1º do art. 59, que a curadoria omitiu por "começar
  antes do pai" e que o parser aceita porque o pai foi renumerado (era o parágrafo único).
- **Renumeração**: `art:55:par:unico` e `art:67:par:unico` da fixture viram redações antigas de
  `art:55:par:1` e `art:67:par:1`, com `labels`.
- **Metadados**: o parser anexa a nota de alteração herdada do pai (com `retroactive`) quando a
  abertura é a dela; a fixture só fazia isso em parte dos casos.
- **Grupo ambíguo**: no art. 62, uma nota fecha dois incisos superados de redações diferentes do
  caput; o parser segue a ordem dos parágrafos e a curadoria escolheu o bloco do pai.
- **CTE**: 10 `headingPath` dos arts. 47 e 48 saem com o título antigo ("Da Sujeição Passiva",
  caixa baixa) porque a redação vigente deles está no bloco da estrutura anterior; 34 redações
  anteriores a 1997 que a fixture omitiu vão para revisão.
- **Chaves só no parser**: dispositivos que a curadoria omitiu por ambiguidade (ex.: incisos do
  § 1º-B do art. 44 do CTE), a maioria publicáveis.

As chaves citadas pelo golden das evals (art. 71, art. 76, §§ 5º, I, 6º, 8º e 9º do RCTE; art. 52
do CTE) saem idênticas, com os mesmos intervalos publicáveis.

## Risks / Trade-offs

- A máquina de estados depende da diagramação do Word da Sefaz-GO. Mitigação: o `source-watch`
  detecta a mudança e o relatório do `load` mostra as taxas antes da promoção.
- `htmlparser2` tolera HTML quebrado; um `<p>` sem fechamento junta parágrafos. Não aconteceu nos
  arquivos de 2026-11-11 (20 parágrafos sem dispositivo no RCTE, 38 no CTE, quase todos fórmulas e
  tabelas dentro de notas).
- O pivô 97 do RCTE converte "96" em 2096 (art. 371, nota de 01.01.96 a 28.12.03): o intervalo sai
  invertido e vai para revisão (`interval-inverted`), em vez de virar 1996 por adivinhação.

## Fontes Context7

| Biblioteca               | ID Context7          | Versão conferida | Tópicos                                                                                                  |
| ------------------------ | -------------------- | ---------------- | -------------------------------------------------------------------------------------------------------- |
| htmlparser2              | `/fb55/htmlparser2`  | 12.0.0           | `Parser` com `onopentag`/`ontext`/`onclosetag`, `write`/`end` em streaming, `decodeEntities` (padrão), atributos em minúsculas |
| fast-check + `@fast-check/vitest` | `/dubzzz/fast-check` | 4.10.2 | `test.prop` (tupla e registro), `fc.record`, `fc.array`, `fc.option`, `fc.constantFrom`, `fc.pre` |

Vitest (4.x) e `TextDecoder` (WHATWG, Node 24) seguem o uso já conferido nas mudanças da F1 e da
F2; nenhuma API nova deles entrou aqui.
