import { parseDoclingGeneric } from './docling-generic.ts'
import { parseDoclingGuia } from './docling-guia.ts'
import { goHtmlStateMachineParser } from './go-html-state-machine.ts'
import { type Parser, ParserName } from './parser.ts'
import { parseReinfXsd } from './reinf-xsd.ts'
import { parseSpedTabela } from './sped-tabelas.ts'

/**
 * Registro dos parsers da ingestão, pelo nome usado em `corpus/sources.yaml` (`parser:`). O
 * `ingest load` escolhe o parser da fonte por aqui; um nome sem parser não compila.
 */
export const PARSERS: Readonly<Record<ParserName, Parser>> = {
  [ParserName.GoHtmlStateMachine]: goHtmlStateMachineParser,
  [ParserName.DoclingGuia]: parseDoclingGuia,
  [ParserName.DoclingGeneric]: parseDoclingGeneric,
  [ParserName.ReinfXsd]: parseReinfXsd,
  [ParserName.SpedTabelas]: parseSpedTabela,
}

/**
 * Revisão de cada parser (ADR 0026). Sobe quando a mudança altera a saída para um arquivo já
 * ingerido (extração, chave, vigência ou texto): o próximo run reprocessa as versões de documento
 * publicadas com revisão menor. Refatoração sem efeito na saída não sobe.
 *
 * - `docling-guia` 2: título do bloco junto ao do registro 0000 e linhas fundidas pelo TableFormer.
 * - `docling-generic` 2: tabela com uma linha por parágrafo e as células com o cabeçalho da coluna
 *   (`Cabeçalho: valor; …`), em vez de achatada num parágrafo só (A8).
 * - `go-html-state-machine` 2: a nota "Redação … sem efeitos a partir de …" termina a redação (ou
 *   tira dela o período "de a a b"), e os títulos acrescidos (`PargrafoAlterador-titulo`, como o
 *   "CAPÍTULO IV-A" da EFD no RCTE) entram no `headingPath`.
 * - `go-html-state-machine` 3: a nota de alteração vai para a redação do dispositivo que ela cita,
 *   mesmo com outra redação no meio (RCTE, art. 12, IV), e quatro formas de `NotaVigncia` que iam
 *   para revisão passam a ser lidas (nota vazia, mês "010", nota da última de várias redações
 *   seguidas e nota que conta a história do dispositivo).
 */
export const PARSER_REVISIONS: Readonly<Record<ParserName, number>> = {
  [ParserName.GoHtmlStateMachine]: 3,
  [ParserName.DoclingGuia]: 2,
  [ParserName.DoclingGeneric]: 2,
  [ParserName.ReinfXsd]: 1,
  [ParserName.SpedTabelas]: 1,
}
