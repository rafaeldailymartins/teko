import type { IsoDate, ValidityInterval } from '@teko/shared/vigencia'
import { Family, Modality, ValidityBasis } from '#domain/corpus/family.ts'
import {
  declaredStartInNote,
  monthNumber,
  narrowByDeclaredStart,
} from '#domain/corpus/leiaute-validity.ts'
import type {
  ParsedProvision,
  ParsedSource,
  ReviewFlag,
  SkippedVersion,
} from '#domain/corpus/parsed-source.ts'
import { buildStableKey } from '#domain/corpus/provision-id.ts'
import { type DoclingBlock, readDoclingBlocks } from './docling/docling-document.ts'
import {
  detectFieldHeader,
  type FieldHeader,
  type FieldRow,
  mergeContinuation,
  startsField,
  toFieldRow,
  validateFieldRows,
} from './docling/field-table.ts'
import { buildVersion, resolveDescribedVersion } from './docling/source-version.ts'
import { ParseError, type Parser } from './parser.ts'

/**
 * Parser do Guia Prático EFD ICMS/IPI a partir do `DoclingDocument` (plano, "Chunking e IDs"):
 * um dispositivo pai por registro e um filho por campo, com `heading_path` no formato
 * `EFD ICMS/IPI > Bloco C > Registro C170 > Campo 07 VL_ITEM` e as mesmas chaves e rótulos da
 * fixture da F2 (`br:efd-icms-ipi:reg:C170:campo:07`).
 *
 * Em cada registro, na ordem de leitura: título ("REGISTRO C170: …"), descrição, tabela de campos
 * (costurada entre páginas quando o cabeçalho se repete ou, sem cabeçalho, quando o número de
 * colunas é o mesmo; linha sem número continua a anterior), "Observações:" (nível e ocorrência)
 * e as notas "Campo NN (NOME) - …", que vão para o campo NN.
 *
 * Vigência: a da versão de documento (período do leiaute), estreitada pelo início declarado do
 * registro ou campo — tabelas "CAMPOS/REGISTROS INCLUÍDOS NO LEIAUTE A PARTIR DO PERÍODO DE
 * APURAÇÃO DE …" do Capítulo I e notas "válido a partir de …" (`narrowByDeclaredStart`). Tabela
 * de campos que falha nas validações (01 a N contíguos, primeiro campo `REG`, `Tipo` ∈ {C, N})
 * gera redações com `review` (`field-table-invalid`).
 */

const FAMILY_LABEL = 'EFD ICMS/IPI'
const DISPLAY_PREFIX = 'Guia Prático EFD-ICMS/IPI'

export const GuiaReviewReason = {
  FieldTableInvalid: 'field-table-invalid',
  FieldTableMissing: 'field-table-missing',
} as const

const REGISTER_HEADING = /^REGISTRO\s+([0-9A-K]\d{3})\b/
const OBSERVATIONS = /^Observa[çc][õo]es\s*:?\s*/i
const FIELD_NOTE = /^Campo\s+(\d{1,3})\b/
const INCLUSION_HEADING =
  /\b(CAMPOS?|REGISTROS?)\s+INCLU[ÍI]DOS?\s+NO\s+LEIAUTE\s+A\s+PARTIR\s+DO\s+PER[ÍI]ODO\s+DE\s+APURA[ÇC][ÃA]O\s+DE\s+(\p{L}+)\s+DE\s+(\d{4})/iu

type Phase = 'description' | 'fields' | 'observations' | 'notes'

interface RawRow {
  readonly header: FieldHeader
  cells: string[]
}

interface RegisterDraft {
  readonly code: string
  readonly heading: string
  readonly description: string[]
  readonly observations: string[]
  readonly rows: RawRow[]
  /** Texto fora da tabela que continua a última linha (linha que quebrou de página). */
  readonly trailing: string[]
  readonly notes: Map<string, string[]>
  header: FieldHeader | null
  numCols: number
  phase: Phase
  currentNote: string | null
}

interface Inclusions {
  readonly fields: Map<string, IsoDate>
  readonly registers: Map<string, IsoDate>
}

function tableText(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) => row.filter((cell) => cell !== '').join(' '))
    .filter((line) => line !== '')
    .join(' ')
}

function newRegister(code: string, heading: string): RegisterDraft {
  return {
    code,
    heading,
    description: [],
    observations: [],
    rows: [],
    trailing: [],
    notes: new Map(),
    header: null,
    numCols: 0,
    phase: 'description',
    currentNote: null,
  }
}

function pushNote(draft: RegisterDraft, numero: string, text: string): void {
  const notes = draft.notes.get(numero)
  if (notes === undefined) {
    draft.notes.set(numero, [text])
  } else {
    notes.push(text)
  }
}

function handleText(draft: RegisterDraft, text: string): void {
  const note = FIELD_NOTE.exec(text)
  if (note && draft.phase !== 'description') {
    draft.phase = 'notes'
    draft.currentNote = (note[1] ?? '').padStart(2, '0')
    pushNote(draft, draft.currentNote, text)
    return
  }
  if (draft.phase !== 'notes' && OBSERVATIONS.test(text)) {
    draft.phase = 'observations'
    const rest = text.replace(OBSERVATIONS, '')
    if (rest !== '') {
      draft.observations.push(rest)
    }
    return
  }
  switch (draft.phase) {
    case 'description':
      draft.description.push(text)
      return
    case 'fields':
      draft.trailing.push(text)
      return
    case 'observations':
      draft.observations.push(text)
      return
    case 'notes':
      pushNote(draft, draft.currentNote ?? '', text)
      return
  }
}

function handleTable(draft: RegisterDraft, rows: readonly (readonly string[])[], numCols: number) {
  const header = rows[0] === undefined ? null : detectFieldHeader(rows[0])
  const body = header === null ? rows : rows.slice(1)
  const stitchable = draft.phase === 'fields' && draft.header !== null
  if (header !== null && (draft.phase === 'description' || stitchable)) {
    draft.header = header
    draft.numCols = numCols
    draft.phase = 'fields'
    draft.rows.push(...body.map((cells) => ({ header, cells: [...cells] })))
    return
  }
  if (header === null && stitchable && draft.header !== null && numCols === draft.numCols) {
    const current = draft.header
    draft.rows.push(...body.map((cells) => ({ header: current, cells: [...cells] })))
    return
  }
  const text = tableText(rows)
  if (text !== '') {
    handleText(draft, text)
  }
}

function readInclusionTable(
  rows: readonly (readonly string[])[],
  scope: 'campos' | 'registros',
  date: IsoDate,
  inclusions: Inclusions,
): void {
  for (const row of rows) {
    const register = row.find((cell) => /^[0-9A-K]\d{3}$/.test(cell))
    if (register === undefined) {
      continue
    }
    if (scope === 'registros') {
      inclusions.registers.set(register, date)
      continue
    }
    const numero = row.find(
      (cell, index) => index > row.indexOf(register) && /^\d{1,3}$/.test(cell),
    )
    if (numero !== undefined) {
      inclusions.fields.set(`${register}:${numero.padStart(2, '0')}`, date)
    }
  }
}

interface Segmented {
  readonly registers: readonly RegisterDraft[]
  readonly inclusions: Inclusions
  readonly skipped: SkippedVersion[]
}

function segment(blocks: readonly DoclingBlock[]): Segmented {
  const registers: RegisterDraft[] = []
  const seen = new Set<string>()
  const skipped: SkippedVersion[] = []
  const inclusions: Inclusions = { fields: new Map(), registers: new Map() }
  let current: RegisterDraft | null = null
  let pendingInclusion: { scope: 'campos' | 'registros'; date: IsoDate } | null = null

  for (const block of blocks) {
    if (block.kind === 'text') {
      const heading = REGISTER_HEADING.exec(block.text)
      if (heading) {
        const code = heading[1] ?? ''
        pendingInclusion = null
        if (seen.has(code)) {
          skipped.push({ stableKey: null, reason: 'duplicate-register', rawNote: block.text })
          current = null
          continue
        }
        seen.add(code)
        current = newRegister(code, block.text)
        registers.push(current)
        continue
      }
      const inclusion = INCLUSION_HEADING.exec(block.text)
      if (inclusion) {
        const month = monthNumber(inclusion[2] ?? '')
        pendingInclusion =
          month === null
            ? null
            : {
                scope: (inclusion[1] ?? '').toUpperCase().startsWith('CAMPO')
                  ? 'campos'
                  : 'registros',
                date: `${inclusion[3] ?? ''}-${String(month).padStart(2, '0')}-01`,
              }
        continue
      }
      if (current !== null) {
        handleText(current, block.text)
      }
      continue
    }
    if (pendingInclusion !== null && current === null) {
      readInclusionTable(block.rows, pendingInclusion.scope, pendingInclusion.date, inclusions)
      pendingInclusion = null
      continue
    }
    if (current === null) {
      skipped.push({
        stableKey: null,
        reason: 'orphan-table',
        rawNote: tableText(block.rows.slice(0, 1)),
      })
      continue
    }
    handleTable(current, block.rows, block.numCols)
  }
  return { registers, inclusions, skipped }
}

function finalizeRows(draft: RegisterDraft): { rows: FieldRow[]; problems: string[] } {
  const problems: string[] = []
  const merged: RawRow[] = []
  for (const row of draft.rows) {
    if (row.cells.every((cell) => cell === '')) {
      continue
    }
    const previous = merged.at(-1)
    if (startsField(row.cells, row.header) || previous === undefined) {
      if (previous === undefined && !startsField(row.cells, row.header)) {
        problems.push('tabela começa sem número de campo')
      }
      merged.push({ header: row.header, cells: [...row.cells] })
    } else {
      previous.cells = mergeContinuation(previous.cells, row.cells)
    }
  }
  const rows = merged.map((row) => toFieldRow(row.cells, row.header))
  const last = rows.at(-1)
  if (last !== undefined && draft.trailing.length > 0) {
    rows[rows.length - 1] = { ...last, rowText: [last.rowText, ...draft.trailing].join(' ') }
  }
  return { rows, problems: [...problems, ...validateFieldRows(rows)] }
}

function registerText(draft: RegisterDraft): string {
  const head = [draft.heading, ...draft.description].join(' ')
  return draft.observations.length > 0
    ? `${head}\nObservações: ${draft.observations.join(' ')}`
    : head
}

function laterOf(a: IsoDate | null | undefined, b: IsoDate | null | undefined): IsoDate | null {
  if (a == null) {
    return b ?? null
  }
  if (b == null) {
    return a
  }
  return a > b ? a : b
}

interface BuildContext {
  readonly documentValidity: ValidityInterval
  readonly inclusions: Inclusions
  readonly skipped: SkippedVersion[]
  declaredStarts: number
  narrowingReviews: number
}

function structuredOf(row: FieldRow): Record<string, string> {
  return {
    numero: row.numero,
    campo: row.campo,
    tipo: row.tipo,
    tamanho: row.tamanho,
    decimais: row.decimais,
    ...row.obligations,
  }
}

function buildRegister(draft: RegisterDraft, context: BuildContext): ParsedProvision[] {
  const registerKey = buildStableKey(Family.EfdIcmsIpi, [{ kind: 'reg', value: draft.code }])
  const headingPath = `${FAMILY_LABEL} > Bloco ${draft.code.charAt(0)} > Registro ${draft.code}`
  const registerLabel = `${DISPLAY_PREFIX}, Registro ${draft.code}`
  const registerStart = laterOf(
    context.inclusions.registers.get(draft.code),
    declaredStartInNote([draft.heading, ...draft.description].join(' ')),
  )
  const registerValidity = narrowByDeclaredStart(
    context.documentValidity,
    registerStart,
    draft.heading,
  )
  if (registerStart !== null) {
    context.declaredStarts += 1
  }
  const { rows, problems } =
    draft.header === null
      ? { rows: [], problems: ['tabela de campos ausente'] }
      : finalizeRows(draft)
  const tableReview: ReviewFlag | undefined =
    problems.length === 0
      ? undefined
      : {
          reason:
            draft.header === null
              ? GuiaReviewReason.FieldTableMissing
              : GuiaReviewReason.FieldTableInvalid,
          rawNote: `Registro ${draft.code}: ${problems.join('; ')}`,
        }
  const registerReview = registerValidity.review ?? (rows.length === 0 ? tableReview : undefined)
  if (registerValidity.review !== undefined) {
    context.narrowingReviews += 1
  }

  const provisions: ParsedProvision[] = [
    {
      stableKey: registerKey,
      kind: 'registro',
      sortPath: draft.code,
      headingPath,
      versions: [
        buildVersion({
          displayLabel: registerLabel,
          validDuring: registerValidity.validDuring,
          modality: Modality.Mandatory,
          validityBasis: ValidityBasis.LeiautePeriod,
          text: registerText(draft),
          review: registerReview,
        }),
      ],
    },
  ]

  const seenFields = new Set<string>()
  for (const row of rows) {
    const fieldKey = `${registerKey}:campo:${row.numero}`
    if (seenFields.has(row.numero) || !/^\d{2,3}$/.test(row.numero)) {
      context.skipped.push({ stableKey: fieldKey, reason: 'duplicate-field', rawNote: row.rowText })
      continue
    }
    seenFields.add(row.numero)
    const notes = draft.notes.get(row.numero) ?? []
    const fieldStart = laterOf(
      context.inclusions.fields.get(`${draft.code}:${row.numero}`),
      declaredStartInNote(notes.join(' ')),
    )
    if (fieldStart !== null) {
      context.declaredStarts += 1
    }
    const fieldValidity = narrowByDeclaredStart(
      registerValidity.validDuring,
      fieldStart,
      notes[0] ?? row.rowText,
    )
    if (fieldValidity.review !== undefined) {
      context.narrowingReviews += 1
    }
    provisions.push({
      stableKey: buildStableKey(Family.EfdIcmsIpi, [
        { kind: 'reg', value: draft.code },
        { kind: 'campo', value: row.numero },
      ]),
      kind: 'campo',
      parent: registerKey,
      sortPath: `${draft.code}.${row.numero}`,
      headingPath: `${headingPath} > Campo ${row.numero} ${row.campo}`,
      versions: [
        buildVersion({
          displayLabel: `${registerLabel}, Campo ${row.numero} (${row.campo})`,
          validDuring: fieldValidity.validDuring,
          modality: Modality.Mandatory,
          validityBasis: ValidityBasis.LeiautePeriod,
          text: notes.length > 0 ? `${row.rowText}\n${notes.join(' ')}` : row.rowText,
          review: tableReview ?? fieldValidity.review,
          structured: structuredOf(row),
        }),
      ],
    })
  }
  return provisions
}

export const parseDoclingGuia: Parser = (input) => {
  if (input.source.family !== Family.EfdIcmsIpi) {
    throw new ParseError(`${input.source.id}: docling-guia só lê o Guia Prático EFD ICMS/IPI`)
  }
  const { version, validDuring } = resolveDescribedVersion(input)
  const { registers, inclusions, skipped } = segment(readDoclingBlocks(input.docling))
  if (registers.length === 0) {
    throw new ParseError(`${input.source.id}: nenhum registro ("REGISTRO XXXX:") no documento`)
  }
  const context: BuildContext = {
    documentValidity: validDuring,
    inclusions,
    skipped,
    declaredStarts: 0,
    narrowingReviews: 0,
  }
  const provisions = registers.flatMap((draft) => buildRegister(draft, context))
  const source: ParsedSource = {
    document: input.source.document,
    version,
    replacementWindow: validDuring,
    provisions,
    skipped,
    stats: {
      notesTotal: context.declaredStarts,
      notesParsed: context.declaredStarts - context.narrowingReviews,
      notesToReview: context.narrowingReviews,
    },
  }
  return source
}
