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
 */
export const PARSER_REVISIONS: Readonly<Record<ParserName, number>> = {
  [ParserName.GoHtmlStateMachine]: 1,
  [ParserName.DoclingGuia]: 2,
  [ParserName.DoclingGeneric]: 1,
  [ParserName.ReinfXsd]: 1,
  [ParserName.SpedTabelas]: 1,
}
