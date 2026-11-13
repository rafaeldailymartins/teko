import { z } from 'zod'
import { ParseError } from '../parser.ts'

/**
 * Leitura do `DoclingDocument` JSON (docling-core 2.105, `schema_name: "DoclingDocument"`,
 * `version` 1.x) gravado pelo `tools/ingest` (`save_as_json`, `image_mode=PLACEHOLDER`).
 *
 * Só o necessário para os parsers: a árvore `body` (filhos por `$ref` JSON Pointer, na ordem de
 * leitura), os itens de texto (`texts`, com `label` e `content_layer`), os grupos (`groups`: listas
 * e áreas chave-valor) e as tabelas (`tables[].data.table_cells`, com os índices de linha e coluna
 * de cada célula). A `grid` de `TableData` é um campo calculado (a mesma informação das células) e
 * não é lida: a grade é remontada aqui a partir de `table_cells`. A página vem de `prov[0].page_no`.
 *
 * Figuras (`pictures`) saem inteiras, com os filhos: sem OCR, os filhos são os rótulos que o
 * Docling achou dentro do desenho (fluxogramas dos Guias EFD-GO: "Contribuinte goiano", "=",
 * aspas soltas), que fora da imagem só poluem o texto do tópico. Legenda de figura não é filho
 * (fica em `captions`) e não aparece nos PDFs do corpus.
 */

const refSchema = z.object({ $ref: z.string() })
const provSchema = z.object({ page_no: z.number().int().positive() })

const nodeFields = {
  self_ref: z.string(),
  label: z.string().optional(),
  content_layer: z.string().optional(),
  children: z.array(refSchema).default([]),
  prov: z.array(provSchema).default([]),
}

const textItemSchema = z.object({ ...nodeFields, label: z.string(), text: z.string() })
const groupItemSchema = z.object(nodeFields)

const tableCellSchema = z.object({
  text: z.string(),
  start_row_offset_idx: z.number().int().nonnegative(),
  end_row_offset_idx: z.number().int().nonnegative(),
  start_col_offset_idx: z.number().int().nonnegative(),
  end_col_offset_idx: z.number().int().nonnegative(),
  /** O TableFormer marca as células de cabeçalho de coluna. */
  column_header: z.boolean().optional(),
})

const tableItemSchema = z.object({
  ...nodeFields,
  data: z.object({
    num_rows: z.number().int().nonnegative(),
    num_cols: z.number().int().nonnegative(),
    table_cells: z.array(tableCellSchema),
  }),
})

const doclingDocumentSchema = z.object({
  schema_name: z.literal('DoclingDocument'),
  version: z.string().regex(/^1\.\d+\.\d+$/),
  body: groupItemSchema,
  groups: z.array(groupItemSchema).default([]),
  texts: z.array(textItemSchema).default([]),
  tables: z.array(tableItemSchema).default([]),
  pictures: z.array(z.object({ self_ref: z.string() })).default([]),
})

type DoclingDocument = z.infer<typeof doclingDocumentSchema>
type TableItem = z.infer<typeof tableItemSchema>

/** Rótulos de texto que nunca são conteúdo (cabeçalho e rodapé de página). */
const FURNITURE_LABELS: ReadonlySet<string> = new Set(['page_header', 'page_footer'])

interface TextBlock {
  readonly kind: 'text'
  /** `section_header`, `text`, `list_item`, `caption`, `footnote`, `title`… */
  readonly label: string
  /** Texto com espaços colapsados. */
  readonly text: string
  readonly page: number | null
}

interface TableBlock {
  readonly kind: 'table'
  /** `table` ou `document_index` (sumário). */
  readonly label: string
  /** Grade `num_rows × num_cols`; célula mesclada fica na primeira posição, as demais vazias. */
  readonly rows: readonly (readonly string[])[]
  readonly numCols: number
  /**
   * Linhas do topo marcadas como cabeçalho de coluna pelo TableFormer (`column_header` em todas as
   * células preenchidas), 0 sem marcação.
   */
  readonly headerRows: number
  readonly page: number | null
}

export type DoclingBlock = TextBlock | TableBlock

/** Espaços colapsados e aparados (o Docling preserva quebras de linha do PDF em alguns textos). */
export function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function parseDocument(raw: unknown, part: number): DoclingDocument {
  const result = doclingDocumentSchema.safeParse(raw)
  if (!result.success) {
    throw new ParseError(`DoclingDocument inválido (parte ${part + 1}): ${result.error.message}`, {
      cause: result.error,
    })
  }
  return result.data
}

function firstPage(prov: readonly { readonly page_no: number }[]): number | null {
  return prov[0]?.page_no ?? null
}

function tableRows(table: TableItem): string[][] {
  const { num_rows: numRows, num_cols: numCols } = table.data
  const rows = Array.from({ length: numRows }, () => Array.from({ length: numCols }, () => ''))
  for (const cell of table.data.table_cells) {
    const row = rows[cell.start_row_offset_idx]
    if (row !== undefined && cell.start_col_offset_idx < numCols) {
      row[cell.start_col_offset_idx] = collapseSpaces(cell.text)
    }
  }
  return rows
}

function headerRows(table: TableItem): number {
  const byRow = Map.groupBy(
    table.data.table_cells.filter((cell) => collapseSpaces(cell.text) !== ''),
    (cell) => cell.start_row_offset_idx,
  )
  let count = 0
  while (byRow.get(count)?.every((cell) => cell.column_header === true) === true) {
    count += 1
  }
  return count
}

const POINTER = /^#\/(texts|groups|tables|pictures)\/(\d+)$/

/** Blocos de uma parte, na ordem de leitura do `body` (busca em profundidade pelos `$ref`). */
function blocksOf(doc: DoclingDocument, part: number): DoclingBlock[] {
  const blocks: DoclingBlock[] = []
  const visited = new Set<string>()
  const visit = (ref: string): void => {
    if (visited.has(ref)) {
      return
    }
    visited.add(ref)
    const match = POINTER.exec(ref)
    if (!match) {
      throw new ParseError(`Referência desconhecida no DoclingDocument (parte ${part + 1}): ${ref}`)
    }
    const collection = match[1]
    const index = Number(match[2])
    if (collection === 'pictures') {
      if (doc.pictures[index] === undefined) {
        throw new ParseError(`Referência quebrada no DoclingDocument (parte ${part + 1}): ${ref}`)
      }
      // A figura e os rótulos de dentro dela não viram blocos (ver o comentário do módulo).
      return
    }
    if (collection === 'texts') {
      const item = doc.texts[index]
      if (item === undefined) {
        throw new ParseError(`Referência quebrada no DoclingDocument (parte ${part + 1}): ${ref}`)
      }
      const text = collapseSpaces(item.text)
      const furniture = item.content_layer === 'furniture' || FURNITURE_LABELS.has(item.label)
      if (!furniture && text !== '') {
        blocks.push({ kind: 'text', label: item.label, text, page: firstPage(item.prov) })
      }
      for (const child of item.children) {
        visit(child.$ref)
      }
      return
    }
    const table = collection === 'tables' ? doc.tables[index] : undefined
    const node = table ?? (collection === 'groups' ? doc.groups[index] : undefined)
    if (node === undefined) {
      throw new ParseError(`Referência quebrada no DoclingDocument (parte ${part + 1}): ${ref}`)
    }
    if (table !== undefined && table.content_layer !== 'furniture') {
      blocks.push({
        kind: 'table',
        label: table.label ?? 'table',
        rows: tableRows(table),
        numCols: table.data.num_cols,
        headerRows: headerRows(table),
        page: firstPage(table.prov),
      })
    }
    for (const child of node.children) {
      visit(child.$ref)
    }
  }
  for (const child of doc.body.children) {
    visit(child.$ref)
  }
  return blocks
}

function minPage(doc: DoclingDocument): number {
  const pages = [...doc.texts, ...doc.tables].flatMap((item) => item.prov.map((p) => p.page_no))
  return pages.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...pages)
}

/**
 * Blocos de todas as partes de um documento (o job `extract` divide documentos longos por
 * `page_range`), ordenadas pela primeira página de cada parte. Lança `ParseError` se uma parte
 * não for um `DoclingDocument` válido ou se não houver nenhuma parte.
 */
export function readDoclingBlocks(parts: readonly unknown[]): DoclingBlock[] {
  if (parts.length === 0) {
    throw new ParseError('Nenhuma saída do Docling para um documento que precisa dela')
  }
  const docs = parts.map((raw, index) => ({ doc: parseDocument(raw, index), index }))
  docs.sort((a, b) => minPage(a.doc) - minPage(b.doc) || a.index - b.index)
  return docs.flatMap(({ doc, index }) => blocksOf(doc, index))
}
