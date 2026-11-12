import { createHash } from 'node:crypto'
import { type IsoDate, isoDateSchema, type ValidityInterval } from '@teko/shared/vigencia'
import { z } from 'zod'
import { Family, Modality, ValidityBasis } from '#domain/corpus/family.ts'
import {
  LeiauteReviewReason,
  overlappingRowIndexes,
  parseDdMmAaaa,
  tableRowInterval,
} from '#domain/corpus/leiaute-validity.ts'
import type { ParsedProvision, ParsedSource, SkippedVersion } from '#domain/corpus/parsed-source.ts'
import { buildStableKey, isStableKey } from '#domain/corpus/provision-id.ts'
import { buildVersion, formatBrazilianDate } from './docling/source-version.ts'
import { type ExternalTableVersion, ParseError, type Parser, type ParserInput } from './parser.ts'

/**
 * Parser das Tabelas de Goiás do WS de Tabelas Externas do SPED (`obterTabela.ashx`): TXT em
 * cp1252, linhas CRLF, campos separados por `|`, datas `DDMMAAAA` e `DT_FIM` vazio = vigente. A
 * primeira linha é o cabeçalho (`versão=5 TIPO_UTIL, DESC_TIPO, DT_INI, DT_FIM`). O WS responde a
 * erros com HTTP 200 e um texto (`Erro o obter Tabela:…`), que vira `ParseError`.
 *
 * Cada código é um dispositivo (`go:tabelas-go:tab:5-5:cod:GO01`) e cada linha uma redação
 * `[DT_INI, DT_FIM + 1)`, com o texto `código - descrição` (o `|` vira `-`). A tabela em si é o
 * dispositivo pai, com o título do WS e o cabeçalho do TXT. As datas são as declaradas na tabela
 * (`table_declared`), não vigência jurídica.
 *
 * Os metadados da versão vêm do `consultarVersoesTabelasExternas` (`id`, `versao`, `desc`,
 * `dtVersao`, `hash` SHA-1), que o pipeline resolve e entrega em `source.externalTable`; o SHA-1
 * dos bytes é conferido com o `hash`. Como o TXT de uma versão traz o histórico inteiro da tabela,
 * a janela de substituição é todo o tempo (código ausente da versão nova tem o `knowledge`
 * fechado).
 */

/**
 * Validação dos metadados que o pipeline entrega em `source.externalTable` (`ExternalTableVersion`):
 * o tipo garante a forma, e isto garante os valores (data ISO, SHA-1 hexadecimal, `desc` não vazio).
 */
const externalTableSchema = z.object({
  /** `idTabela` do WS (37 = 5.1.1, 38 = 5.2, 39 = 5.3, 40 = 5.5). */
  id: z.number().int().positive(),
  versao: z.number().int().positive(),
  /** Ex.: `5.5-  Tabela de Tipos de Utilização dos Créditos Fiscais - ICMS`, literal do WS. */
  desc: z.string().min(1),
  dtVersao: isoDateSchema,
  /** SHA-1 do TXT, em hexadecimal (o WS publica em maiúsculas). */
  hash: z.string().regex(/^[0-9A-Fa-f]{40}$/),
}) satisfies z.ZodType<ExternalTableVersion>

const HEADING_ROOT = 'Tabelas da EFD ICMS/IPI de Goiás'
const TABLE_NUMBER = /^(\d{1,2}(?:\.\d{1,2}){0,3})\s*-/
const HEADER_LINE = /^vers[ãa]o=(\d+)\s/

function readMeta(input: ParserInput): ExternalTableVersion {
  const result = externalTableSchema.safeParse(input.source.externalTable)
  if (!result.success) {
    throw new ParseError(
      `${input.source.id}: faltam os metadados do consultarVersoesTabelasExternas (source.externalTable)`,
      { cause: result.error },
    )
  }
  return result.data
}

interface CodeRow {
  readonly code: string
  readonly description: string
  readonly validDuring: ValidityInterval
  readonly line: string
}

function parseRows(lines: readonly string[], skipped: SkippedVersion[]): CodeRow[] {
  const rows: CodeRow[] = []
  for (const line of lines) {
    // `COD|DESC|DT_INI|DT_FIM`; com `DT_FIM` vazio, a linha termina em `|`.
    const fields = line.split('|')
    if (fields.length < 4) {
      skipped.push({ stableKey: null, reason: 'malformed-row', rawNote: line })
      continue
    }
    const code = (fields[0] ?? '').trim()
    const dtIni = parseDdMmAaaa(fields.at(-2) ?? '')
    const dtFimText = (fields.at(-1) ?? '').trim()
    const dtFim = dtFimText === '' ? null : parseDdMmAaaa(dtFimText)
    if (dtIni === null || (dtFimText !== '' && dtFim === null)) {
      skipped.push({ stableKey: null, reason: 'invalid-date', rawNote: line })
      continue
    }
    const validDuring = tableRowInterval(dtIni, dtFim)
    if (validDuring === null) {
      skipped.push({ stableKey: null, reason: 'empty-interval', rawNote: line })
      continue
    }
    rows.push({ code, description: fields.slice(1, -2).join(' - ').trim(), validDuring, line })
  }
  return rows
}

function earliest(rows: readonly CodeRow[]): IsoDate | null {
  const starts = rows.map((row) => row.validDuring.from).filter((from) => from !== null)
  return starts.length === 0 ? null : ([...starts].sort()[0] ?? null)
}

export const parseSpedTabela: Parser = (input) => {
  if (input.source.family !== Family.TabelasGo) {
    throw new ParseError(`${input.source.id}: sped-tabelas só lê as Tabelas de Goiás`)
  }
  const meta = readMeta(input)
  const text = new TextDecoder('windows-1252').decode(input.bytes)
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  const header = lines[0] ?? ''
  const headerMatch = HEADER_LINE.exec(header)
  if (!headerMatch) {
    throw new ParseError(
      `${input.source.id}: resposta do WS não é uma tabela: ${header.slice(0, 200)}`,
    )
  }
  if (Number(headerMatch[1]) !== meta.versao) {
    throw new ParseError(
      `${input.source.id}: TXT da versão ${headerMatch[1] ?? '?'}, metadados da versão ${meta.versao}`,
    )
  }
  const sha1 = createHash('sha1').update(input.bytes).digest('hex')
  if (sha1 !== meta.hash.toLowerCase()) {
    throw new ParseError(`${input.source.id}: SHA-1 ${sha1} diferente do hash do WS ${meta.hash}`)
  }
  const tableNumber = TABLE_NUMBER.exec(meta.desc)?.[1]
  if (tableNumber === undefined) {
    throw new ParseError(`${input.source.id}: número da tabela ausente em "${meta.desc}"`)
  }
  const tableSlug = tableNumber.replaceAll('.', '-')
  const tableLabel = `Tabela ${tableNumber} (GO)`
  const tableKey = buildStableKey(Family.TabelasGo, [{ kind: 'tab', value: tableSlug }])
  const tableHeading = `${HEADING_ROOT} > Tabela ${tableNumber}`

  const skipped: SkippedVersion[] = []
  const rows = parseRows(lines.slice(1), skipped)
  const byCode = new Map<string, CodeRow[]>()
  for (const row of rows) {
    const key = `${tableKey}:cod:${row.code}`
    if (!isStableKey(key)) {
      skipped.push({ stableKey: null, reason: 'invalid-code', rawNote: row.line })
      continue
    }
    byCode.set(row.code, [...(byCode.get(row.code) ?? []), row])
  }

  let reviews = 0
  const codes: ParsedProvision[] = [...byCode.entries()].map(([code, codeRows]) => {
    const sorted = [...codeRows].sort((a, b) =>
      String(a.validDuring.from).localeCompare(String(b.validDuring.from)),
    )
    const overlapping = new Set(overlappingRowIndexes(sorted.map((row) => row.validDuring)))
    reviews += overlapping.size
    return {
      stableKey: `${tableKey}:cod:${code}`,
      kind: 'codigo',
      parent: tableKey,
      sortPath: `${tableSlug}.${code}`,
      headingPath: `${tableHeading} > ${code}`,
      versions: sorted.map((row, index) =>
        buildVersion({
          displayLabel: `${tableLabel}, código ${code}`,
          validDuring: row.validDuring,
          modality: Modality.Mandatory,
          validityBasis: ValidityBasis.TableDeclared,
          text: `${code} - ${row.description}`,
          review: overlapping.has(index)
            ? { reason: LeiauteReviewReason.OverlappingRows, rawNote: row.line }
            : undefined,
        }),
      ),
    }
  })

  const tableProvision: ParsedProvision = {
    stableKey: tableKey,
    kind: 'tabela',
    sortPath: tableSlug,
    headingPath: tableHeading,
    versions: [
      buildVersion({
        displayLabel: tableLabel,
        validDuring: { from: earliest(rows) ?? meta.dtVersao, to: null },
        modality: Modality.Mandatory,
        validityBasis: ValidityBasis.TableDeclared,
        text: `${meta.desc}\n${header.trim()}`,
      }),
    ],
  }

  const source: ParsedSource = {
    document: input.source.document,
    version: {
      versionLabel: `${tableLabel}, versão ${meta.versao} de ${formatBrazilianDate(meta.dtVersao)}`,
      publishedOn: meta.dtVersao,
      validDuring: { from: meta.dtVersao, to: null },
      consolidatedUntil: null,
      actRef: input.source.actRef,
      sha256: input.sha256,
    },
    replacementWindow: { from: null, to: null },
    provisions: [tableProvision, ...codes],
    skipped,
    stats: { notesTotal: rows.length, notesParsed: rows.length - reviews, notesToReview: reviews },
  }
  return source
}
