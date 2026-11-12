import { readFileSync } from 'node:fs'
import type { Family } from '#domain/corpus/family.ts'
import type { ParserInput, ParserName, SourceDescriptor } from '../parser.ts'

/**
 * Apoio aos testes dos parsers do SPED: descritores de fonte, entradas de parser e um construtor
 * de `DoclingDocument` mínimo, fiel ao schema do docling-core (mesmos campos que o
 * `save_as_json` grava, sem coordenadas), para os casos que a saída real não cobre.
 */

function fixturePath(relative: string): URL {
  return new URL(`../__fixtures__/${relative}`, import.meta.url)
}

export function readFixtureJson(relative: string): unknown {
  return JSON.parse(readFileSync(fixturePath(relative), 'utf8'))
}

export function readFixtureBytes(relative: string): Uint8Array {
  return new Uint8Array(readFileSync(fixturePath(relative)))
}

export function makeSource(
  overrides: Partial<SourceDescriptor> & {
    readonly id: string
    readonly family: Family
    readonly parser: ParserName
  },
): SourceDescriptor {
  return {
    url: 'https://www.gov.br/sped/',
    document: {
      slug: 'documento-de-teste',
      family: overrides.family,
      title: 'Documento de teste',
      issuer: 'Emissor de teste',
      sourceUrl: 'https://www.gov.br/sped/',
    },
    versionLabel: null,
    publishedOn: null,
    versionValidDuring: null,
    effectiveFrom: null,
    optionalFrom: null,
    mandatoryFrom: null,
    yearPivot: null,
    actRef: null,
    ...overrides,
  }
}

export function makeInput(
  source: SourceDescriptor,
  options: {
    readonly bytes?: Uint8Array
    readonly docling?: readonly unknown[]
    readonly members?: ReadonlyMap<string, Uint8Array>
  } = {},
): ParserInput {
  return {
    source,
    sha256: 'a'.repeat(64),
    bytes: options.bytes ?? new Uint8Array(),
    docling: options.docling ?? [],
    members: options.members ?? new Map(),
  }
}

export type SyntheticBlock =
  | { readonly text: string; readonly label?: string; readonly page?: number }
  | { readonly table: readonly (readonly string[])[]; readonly page?: number }

export interface SyntheticDocling {
  readonly texts: readonly Record<string, unknown>[]
  readonly tables: readonly Record<string, unknown>[]
  readonly [field: string]: unknown
}

/** `DoclingDocument` 1.10.0 com os blocos no `body`, na ordem dada. */
export function syntheticDocling(blocks: readonly SyntheticBlock[]): SyntheticDocling {
  const texts: Record<string, unknown>[] = []
  const tables: Record<string, unknown>[] = []
  const children: { $ref: string }[] = []
  const prov = (page: number) => [
    {
      page_no: page,
      bbox: { l: 0, t: 0, r: 1, b: 1, coord_origin: 'BOTTOMLEFT' },
      charspan: [0, 0],
    },
  ]
  for (const block of blocks) {
    const page = block.page ?? 1
    if ('text' in block) {
      const ref = `#/texts/${texts.length}`
      texts.push({
        self_ref: ref,
        parent: { $ref: '#/body' },
        children: [],
        content_layer: 'body',
        label: block.label ?? 'text',
        prov: prov(page),
        orig: block.text,
        text: block.text,
      })
      children.push({ $ref: ref })
      continue
    }
    const ref = `#/tables/${tables.length}`
    const numCols = Math.max(0, ...block.table.map((row) => row.length))
    tables.push({
      self_ref: ref,
      parent: { $ref: '#/body' },
      children: [],
      content_layer: 'body',
      label: 'table',
      prov: prov(page),
      captions: [],
      references: [],
      footnotes: [],
      data: {
        num_rows: block.table.length,
        num_cols: numCols,
        table_cells: block.table.flatMap((row, rowIndex) =>
          row.map((text, colIndex) => ({
            row_span: 1,
            col_span: 1,
            start_row_offset_idx: rowIndex,
            end_row_offset_idx: rowIndex + 1,
            start_col_offset_idx: colIndex,
            end_col_offset_idx: colIndex + 1,
            text,
            column_header: rowIndex === 0,
            row_header: false,
            row_section: false,
            fillable: false,
          })),
        ),
      },
      annotations: [],
    })
    children.push({ $ref: ref })
  }
  return {
    schema_name: 'DoclingDocument',
    version: '1.10.0',
    name: 'sintetico',
    origin: { mimetype: 'application/pdf', binary_hash: 0, filename: 'sintetico.pdf' },
    furniture: {
      self_ref: '#/furniture',
      children: [],
      content_layer: 'furniture',
      name: '_root_',
      label: 'unspecified',
    },
    body: {
      self_ref: '#/body',
      children,
      content_layer: 'body',
      name: '_root_',
      label: 'unspecified',
    },
    groups: [],
    texts,
    pictures: [],
    tables,
    key_value_items: [],
    form_items: [],
    pages: {},
  }
}
