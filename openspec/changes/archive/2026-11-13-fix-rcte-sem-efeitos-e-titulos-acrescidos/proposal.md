# Proposal

## Why

A revisão do holdout de 2026-11-13 (`docs/evals/revisao-holdout-2026-11-13.md`) achou dois defeitos
do `go-html-state-machine` contra o `RCTE.htm` real:

1. **Nota "sem efeitos a partir de" ignorada.** A NOTA "Redação do inciso VIII sem efeitos a partir
   de 23 de junho de 2022 em função da Lei Complementar Federal nº 194" vem num parágrafo editorial
   (`NotaDisc*`), que o parser trata como transparente. O 23% do álcool carburante (RCTE art. 20,
   § 1º, VIII) fica vigente desde 2018-01-01, sem fim. No § 1º, IX, a nota ("sem efeitos de
   23.06.22 a 29.04.23") vem em `TextoRevo` e o "1." dela vira um item falso do inciso.
2. **Título acrescido não reconhecido.** "CAPÍTULO IV-A DA ESCRITURAÇÃO FISCAL DIGITAL - EFD" vem
   com a classe `PargrafoAlterador-titulo`, que o parser não lê. Os arts. 356-C a 356-S herdam
   "CAPÍTULO IV - DOS LIVROS FISCAIS > Seção XII - Do Livro de Movimentação de Produto - LMP", e
   esse título vai para o texto do embedding. O mesmo vale para outras seis subseções e capítulos
   acrescidos no RCTE e um no CTE.

Corrigir o parser não basta para o título: a reconciliação reaproveita a redação de mesmo texto e
vigência, e os chunks dela continuariam com o título antigo.

## What Changes

- A nota "Redação d… <rótulo> sem efeitos a partir de <data>" (ou "desde", ou "de <data> a
  <data>"), em qualquer classe de nota ou texto, termina a redação citada na data, ou tira dela o
  período fechado (a redação vira duas versões com o mesmo texto). A redação atingida é a primeira
  ainda sem fim do dispositivo citado, publicada depois da última redação do pai. Rótulo que não
  casa, data ilegível ou segunda nota para a mesma redação vão para a revisão.
- O cabeçalho "NOTAS:" em `TextoRevo`/`ParNormal` deixa de entrar no texto da redação.
- Parágrafos `PargrafoAlterador-titulo` são títulos: "CAPÍTULO IV-A", "Subseção V-A" etc. entram no
  `headingPath` e zeram os níveis abaixo deles.
- A identidade da redação na reconciliação passa a incluir o título gravado nos chunks: título
  diferente fecha a redação antiga e insere a nova (com embedding novo).
- `PARSER_REVISIONS[go-html-state-machine]` sobe para 2: o próximo run reprocessa o RCTE e o CTE.

## Capabilities

### Modified Capabilities

- `rcte-cte-parser`: notas "sem efeitos" e títulos acrescidos.
- `embedding-pipeline`: requisito novo, o título entra na identidade da reconciliação.

## Impact

- `apps/api/src/domain/corpus/validity.ts` (`parseWithoutEffectNote`, corte na linha do tempo),
  `go-html-state-machine.ts`, `parsers/index.ts`, `ingest-document-version.ts`, a porta e o
  repositório de ingestão (`lockOpenVersions` lê o `heading_path` do primeiro chunk). Sem migração.
- RCTE: 6 dispositivos mudam de vigência, 1 item falso some e 717 dispositivos (820 redações)
  mudam de `headingPath`; CTE: 6 e 4. As `NotaVigncia` em revisão não mudam (40 e 11).
