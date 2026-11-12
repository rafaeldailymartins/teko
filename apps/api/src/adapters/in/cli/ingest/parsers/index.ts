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
