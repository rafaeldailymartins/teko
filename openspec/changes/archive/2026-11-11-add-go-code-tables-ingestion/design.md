# Design

## Context

O WS de Tabelas Externas do SPED tem duas operações públicas: `consultarVersoesTabelasExternas`
(GET, `codigoSistema=SpedFiscal`), que devolve um `metadadosXml` com uma linha por tabela (`id`,
`tipo`, `desc`, `versao`, `dtCriacao`, `dtVersao`, `hash` SHA-1), e `obterTabela.ashx?idTabela=
&versao=`, que devolve o TXT da versão. As tabelas de Goiás são os ids 37 (5.1.1), 38 (5.2), 39
(5.3) e 40 (5.5). Conferido em 2026-11-11: o TXT da 5.5 versão 5 tem SHA-1 `c73de8…92c9`, igual ao
`hash` do metadado, e uma versão inexistente responde HTTP 200 `text/html` com o corpo
`Erro o obter Tabela:VERSAO_TABELA_EXTERNA_NAO_ENCONTRADA.`

## Goals / Non-Goals

**Goals:**

- Reproduzir a fixture da F2 (chave, título, rótulo, texto e vigência de cada código e da tabela).
- Recusar resposta de erro e arquivo que não bate com os metadados, sem gravar nada.

**Non-Goals:**

- Vigência jurídica: as datas são as declaradas na tabela (`table_declared`), e a resposta avisa
  que não são vigência jurídica (regra da API, fora desta mudança).

## Decisions

- **Formato da linha.** `COD|DESC|DT_INI|DT_FIM`, com a linha terminando em `|` quando `DT_FIM` é
  vazio. A descrição é tudo entre o código e as duas datas; um `|` dentro dela vira ` - `. Linha
  com menos de quatro campos (`malformed-row`), data inválida (`invalid-date`), `DT_FIM` antes de
  `DT_INI` (`empty-interval`) ou código fora da gramática da `stable_key` (`invalid-code`) vai para
  o log (`skipped`), e o resto da tabela publica.
- **Linhas sobrepostas.** As linhas de um código são ordenadas por `DT_INI`; a que se sobrepõe a
  uma anterior sai com `review: overlapping-rows` (`pending`), e as demais publicam. Como o
  `pv_no_overlap` ignora `pending`, a anomalia não aborta a versão.
- **Metadados pelo descritor.** O TXT só tem `versão=N` no cabeçalho, sem data nem título. O
  pipeline já consulta o `consultarVersoesTabelasExternas` para descobrir versões novas; ele
  entrega a linha da tabela no descritor, em `source.externalTable` (`{id, versao, desc, dtVersao,
  hash}`). O parser lê o campo com zod (sem depender de uma mudança de tipo no contrato) e:
  confere `versão=N` do TXT com `versao`, confere o SHA-1 dos bytes com `hash`, tira o número da
  tabela de `desc` (`5.5-  Tabela…` → `5.5`, slug `5-5`) e monta o rótulo da versão
  (`Tabela 5.5 (GO), versão 5 de 04/11/2024`) e `publishedOn` = `dtVersao`. O `desc` vai literal
  para o texto do dispositivo da tabela (com os espaços do WS), como na fixture.
- **Janela de substituição.** O TXT de uma versão traz o histórico inteiro da tabela: a janela é
  todo o tempo (`{from: null, to: null}`), e um código que some da versão nova tem o `knowledge`
  fechado na reconciliação. A versão de documento vale `[dtVersao, ∞)`.
- **Dispositivo da tabela.** Texto `desc` + `\n` + a primeira linha do TXT; vigência desde o menor
  `DT_INI` (ou `dtVersao`, se não houver linha válida).
- **Codificação.** `TextDecoder('windows-1252')` explícito; o SHA-1 é calculado sobre os bytes
  originais (`node:crypto`, permitido no adapter).

## Risks / Trade-offs

- **Campo fora do contrato.** `externalTable` ainda não está no tipo `SourceDescriptor`; enquanto
  não estiver, só o parser o conhece. A alternativa (codificar os metadados em `versionLabel` e
  `actRef`) perderia o `hash` e o `desc` literal.
- **Fixtures TXT e o `.gitattributes`.** Com `* text=auto eol=lf`, o Git converteria o CRLF das
  fixtures e o SHA-1 deixaria de bater; elas precisam de `-text`.

## Fontes Context7

Nenhuma biblioteca nova: `zod` 4.6.7 (já conferido na F1) e `node:crypto`/`TextDecoder` do Node 24.
O WS de Tabelas Externas não tem documentação no Context7; o formato foi conferido nas respostas
reais (ver Context).
