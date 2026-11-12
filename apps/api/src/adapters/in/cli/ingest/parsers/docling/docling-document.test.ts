import { describe, expect, it } from 'vitest'
import { ParseError } from '../parser.ts'
import { collapseSpaces, readDoclingBlocks } from './docling-document.ts'
import { type SyntheticDocling, syntheticDocling } from './testing.ts'

function withBody(doc: SyntheticDocling, patch: Record<string, unknown>) {
  return { ...doc, ...patch }
}

describe('readDoclingBlocks', () => {
  it('ordena as partes pela primeira página e ignora cabeçalho, rodapé e furniture', () => {
    const second = syntheticDocling([{ text: 'Página 2', page: 2 }])
    const first = syntheticDocling([
      { text: 'Cabeçalho', label: 'page_header', page: 1 },
      { text: '  Texto   da\npágina 1 ', page: 1 },
      { text: '   ', page: 1 },
      {
        table: [
          ['a', 'b'],
          ['c', ''],
        ],
        page: 1,
      },
    ])
    const blocks = readDoclingBlocks([second, first])
    expect(blocks).toEqual([
      { kind: 'text', label: 'text', text: 'Texto da página 1', page: 1 },
      {
        kind: 'table',
        label: 'table',
        rows: [
          ['a', 'b'],
          ['c', ''],
        ],
        numCols: 2,
        page: 1,
      },
      { kind: 'text', label: 'text', text: 'Página 2', page: 2 },
    ])
  })

  it('percorre grupos e filhos (listas, legendas), sem repetir nós e sem prov', () => {
    const doc = syntheticDocling([{ text: 'Item 1' }, { text: 'Legenda' }, { table: [['x']] }])
    const { texts, tables } = doc
    const patched = withBody(doc, {
      body: {
        self_ref: '#/body',
        children: [{ $ref: '#/groups/0' }, { $ref: '#/tables/0' }, { $ref: '#/groups/0' }],
      },
      groups: [{ self_ref: '#/groups/0', label: 'list', children: [{ $ref: '#/texts/0' }] }],
      texts: [texts[0], { ...texts[1], prov: [] }],
      tables: [{ ...tables[0], children: [{ $ref: '#/texts/1' }] }],
    })
    expect(readDoclingBlocks([patched]).map((block) => [block.kind, block.page])).toEqual([
      ['text', 1],
      ['table', 1],
      ['text', null],
    ])
  })

  it('célula mesclada fica na primeira posição; célula fora da grade é ignorada; tabela furniture sai', () => {
    const doc = syntheticDocling([{ table: [['a']] }, { table: [['z']] }])
    const { tables } = doc
    const merged = {
      ...tables[0],
      data: {
        num_rows: 2,
        num_cols: 2,
        table_cells: [
          {
            text: 'mesclada',
            start_row_offset_idx: 0,
            end_row_offset_idx: 1,
            start_col_offset_idx: 0,
            end_col_offset_idx: 2,
          },
          {
            text: 'fora',
            start_row_offset_idx: 5,
            end_row_offset_idx: 6,
            start_col_offset_idx: 0,
            end_col_offset_idx: 1,
          },
          {
            text: 'fora',
            start_row_offset_idx: 1,
            end_row_offset_idx: 2,
            start_col_offset_idx: 9,
            end_col_offset_idx: 10,
          },
        ],
      },
    }
    const blocks = readDoclingBlocks([
      withBody(doc, { tables: [merged, { ...tables[1], content_layer: 'furniture' }] }),
    ])
    expect(blocks).toEqual([
      {
        kind: 'table',
        label: 'table',
        rows: [
          ['mesclada', ''],
          ['', ''],
        ],
        numCols: 2,
        page: 1,
      },
    ])
  })

  it('documento vazio, inválido ou com referência quebrada vira ParseError', () => {
    expect(() => readDoclingBlocks([])).toThrow(ParseError)
    const doc = syntheticDocling([{ text: 'a' }])
    expect(() => readDoclingBlocks([{ ...doc, version: '2.0.0' }])).toThrow(/inválido/)
    const broken = (ref: string) =>
      withBody(doc, { body: { self_ref: '#/body', children: [{ $ref: ref }] } })
    expect(() => readDoclingBlocks([broken('#/texts/9')])).toThrow(/Referência quebrada/)
    expect(() => readDoclingBlocks([broken('#/tables/9')])).toThrow(/Referência quebrada/)
    expect(() => readDoclingBlocks([broken('#/pictures/0')])).toThrow(/Referência quebrada/)
    expect(() => readDoclingBlocks([broken('#/key_value_items/0')])).toThrow(
      /Referência desconhecida/,
    )
  })

  it('figura sai com os rótulos de dentro dela; o texto depois dela continua', () => {
    const doc = syntheticDocling([
      { text: 'Antes', page: 1 },
      { text: 'Contribuinte goiano', page: 2 },
      { text: 'Depois', page: 2 },
    ])
    const patched = withBody(doc, {
      body: {
        self_ref: '#/body',
        children: [{ $ref: '#/texts/0' }, { $ref: '#/pictures/0' }, { $ref: '#/texts/2' }],
      },
      pictures: [{ self_ref: '#/pictures/0', label: 'picture', children: [{ $ref: '#/texts/1' }] }],
    })
    expect(
      readDoclingBlocks([patched]).map((block) => block.kind === 'text' && block.text),
    ).toEqual(['Antes', 'Depois'])
  })

  it('parte sem nenhum item com página vai para o fim', () => {
    const empty = syntheticDocling([])
    const withText = syntheticDocling([{ text: 'conteúdo', page: 3 }])
    expect(readDoclingBlocks([empty, withText])).toHaveLength(1)
  })

  it('collapseSpaces', () => {
    expect(collapseSpaces(' a\n\tb  ')).toBe('a b')
  })
})
