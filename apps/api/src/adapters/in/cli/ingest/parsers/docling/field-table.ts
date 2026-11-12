/**
 * Tabelas de campos do Guia Prático EFD ICMS/IPI ("Nº | Campo | Descrição | Tipo | Tam | Dec |
 * Obrig" ou, nos registros de documentos, "… | Entr | Saída"): reconhecimento do cabeçalho,
 * costura das partes que quebram de página e validação (campos contíguos de 01 a N, primeiro
 * campo `REG`, `Tipo` ∈ {C, N}).
 */

export const FieldColumn = {
  Numero: 'numero',
  Campo: 'campo',
  Descricao: 'descricao',
  Tipo: 'tipo',
  Tamanho: 'tamanho',
  Decimais: 'decimais',
  Obrigatoriedade: 'obrigatoriedade',
  Entrada: 'entrada',
  Saida: 'saida',
} as const
export type FieldColumn = (typeof FieldColumn)[keyof typeof FieldColumn]

/** Coluna de cada posição da tabela (`null` = coluna desconhecida, só vai para o texto). */
export type FieldHeader = readonly (FieldColumn | null)[]

function headerKey(cell: string): string {
  return cell
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
}

const HEADER_ALIASES: ReadonlyMap<string, FieldColumn> = new Map([
  ['n', FieldColumn.Numero],
  ['no', FieldColumn.Numero],
  ['num', FieldColumn.Numero],
  ['campo', FieldColumn.Campo],
  ['descricao', FieldColumn.Descricao],
  ['tipo', FieldColumn.Tipo],
  ['tam', FieldColumn.Tamanho],
  ['tamanho', FieldColumn.Tamanho],
  ['dec', FieldColumn.Decimais],
  ['decimais', FieldColumn.Decimais],
  ['obrig', FieldColumn.Obrigatoriedade],
  ['obrigatoriedade', FieldColumn.Obrigatoriedade],
  ['entr', FieldColumn.Entrada],
  ['entrada', FieldColumn.Entrada],
  ['saida', FieldColumn.Saida],
])

/**
 * Cabeçalho de uma tabela de campos, ou `null` se a linha não for um. Exige as colunas `Nº`,
 * `Campo` e `Tipo` (as demais tabelas do Guia, de códigos e de registros, não têm as três).
 */
export function detectFieldHeader(row: readonly string[]): FieldHeader | null {
  const header = row.map((cell) => HEADER_ALIASES.get(headerKey(cell)) ?? null)
  const required = [FieldColumn.Numero, FieldColumn.Campo, FieldColumn.Tipo]
  return required.every((column) => header.includes(column)) ? header : null
}

export interface FieldRow {
  /** Número com 2 dígitos (`07`). */
  readonly numero: string
  readonly campo: string
  readonly tipo: string
  readonly tamanho: string
  readonly decimais: string
  /** Obrigatoriedade única (`obrigatoriedade`) ou por operação (`entrada` e `saida`). */
  readonly obligations: Readonly<Partial<Record<'obrigatoriedade' | 'entrada' | 'saida', string>>>
  /** Células na ordem da tabela, separadas por espaço (o texto da redação começa por ela). */
  readonly rowText: string
  /**
   * Linha refeita de uma fusão do TableFormer cuja descrição não pôde ser dividida com segurança:
   * o campo leva a descrição inteira das linhas fundidas e a redação vai para revisão.
   */
  readonly mergedDescription?: true
}

const MERGED_NUMBERS = /^\d{1,3}(?: \d{1,3})+$/
/** Colunas de um valor curto sem espaço por linha (o campo junta os pedaços quebrados no PDF). */
const TOKEN_COLUMNS: ReadonlySet<FieldColumn> = new Set([
  FieldColumn.Numero,
  FieldColumn.Campo,
  FieldColumn.Tipo,
  FieldColumn.Tamanho,
  FieldColumn.Decimais,
  FieldColumn.Obrigatoriedade,
  FieldColumn.Entrada,
  FieldColumn.Saida,
])

/**
 * Cortes da descrição fundida: começo de palavra maiúscula logo depois de palavra que termina em
 * minúscula ("… documento fiscal Indicador do tipo …"). Valores depois de "-" ou ":" ("0 - À
 * vista") não contam. `null` quando o número de cortes não é exatamente `count - 1`.
 */
function splitDescription(text: string, count: number): string[] | null {
  const words = text.split(' ').filter((word) => word !== '')
  const starts = [0]
  for (let index = 1; index < words.length; index += 1) {
    if (/^\p{Lu}/u.test(words[index] ?? '') && /\p{Ll}$/u.test(words[index - 1] ?? '')) {
      starts.push(index)
    }
  }
  if (starts.length !== count) {
    return null
  }
  return starts.map((start, index) => words.slice(start, starts[index + 1]).join(' '))
}

export interface SplitRow {
  readonly cells: string[]
  readonly mergedDescription: boolean
}

/**
 * Desfaz uma linha em que o TableFormer fundiu linhas consecutivas da tabela de campos: a coluna
 * `Nº` traz vários números ("12 13") e cada coluna curta, os valores das linhas separados por
 * espaço ("VL_DOC IND_PGTO", "N C"). Devolve `null` se a linha não é uma fusão ou se alguma
 * coluna curta não tem um valor por linha (aí ela segue como antes, para a validação acusar).
 */
export function splitMergedRow(row: readonly string[], header: FieldHeader): SplitRow[] | null {
  const numbers = cellOf(row, header, FieldColumn.Numero).trim()
  if (!MERGED_NUMBERS.test(numbers)) {
    return null
  }
  const count = numbers.split(' ').length
  const columns: (readonly string[])[] = []
  let mergedDescription = false
  for (const [index, column] of header.entries()) {
    const cell = (row[index] ?? '').trim()
    if (column !== null && TOKEN_COLUMNS.has(column)) {
      const tokens = cell === '' ? [] : cell.split(/\s+/)
      if (tokens.length === 0) {
        columns.push(Array.from({ length: count }, () => ''))
        continue
      }
      if (tokens.length !== count) {
        return null
      }
      columns.push(tokens)
      continue
    }
    if (column === FieldColumn.Descricao) {
      const parts = splitDescription(cell, count)
      mergedDescription = parts === null
      columns.push(parts ?? Array.from({ length: count }, () => cell))
      continue
    }
    // Coluna desconhecida: o texto fica com a primeira linha, para não se repetir.
    columns.push(Array.from({ length: count }, (_, line) => (line === 0 ? cell : '')))
  }
  return Array.from({ length: count }, (_, line) => ({
    cells: columns.map((values) => values[line] ?? ''),
    mergedDescription,
  }))
}

const NUMBER = /^\d{1,3}$/

function cellOf(row: readonly string[], header: FieldHeader, column: FieldColumn): string {
  const index = header.indexOf(column)
  return index < 0 ? '' : (row[index] ?? '')
}

/** A linha começa um campo (número na coluna `Nº`)? Linhas sem número continuam a anterior. */
export function startsField(row: readonly string[], header: FieldHeader): boolean {
  return NUMBER.test(cellOf(row, header, FieldColumn.Numero))
}

/** Junta uma linha de continuação (sem número) à anterior, célula a célula. */
export function mergeContinuation(
  previous: readonly string[],
  continuation: readonly string[],
): string[] {
  const length = Math.max(previous.length, continuation.length)
  return Array.from({ length }, (_, index) =>
    [previous[index] ?? '', continuation[index] ?? ''].filter((cell) => cell !== '').join(' '),
  )
}

export function toFieldRow(row: readonly string[], header: FieldHeader): FieldRow {
  const obligations: Partial<Record<'obrigatoriedade' | 'entrada' | 'saida', string>> = {}
  for (const column of [FieldColumn.Obrigatoriedade, FieldColumn.Entrada, FieldColumn.Saida]) {
    if (header.includes(column)) {
      obligations[column] = cellOf(row, header, column)
    }
  }
  return {
    numero: cellOf(row, header, FieldColumn.Numero).padStart(2, '0'),
    // Nomes de campo nunca têm espaço; o PDF às vezes quebra o nome (`QUANT_BC_COF INS`).
    campo: cellOf(row, header, FieldColumn.Campo).replace(/\s+/g, ''),
    tipo: cellOf(row, header, FieldColumn.Tipo),
    tamanho: cellOf(row, header, FieldColumn.Tamanho),
    decimais: cellOf(row, header, FieldColumn.Decimais),
    obligations,
    rowText: row.filter((cell) => cell !== '').join(' '),
  }
}

/** Problemas de uma tabela de campos; vazio quando ela passa nas validações do plano. */
export function validateFieldRows(rows: readonly FieldRow[]): readonly string[] {
  const problems: string[] = []
  if (rows.length === 0) {
    return ['tabela de campos vazia']
  }
  if (rows[0]?.campo !== 'REG') {
    problems.push(`primeiro campo é ${rows[0]?.campo ?? '?'}, não REG`)
  }
  rows.forEach((row, index) => {
    const expected = String(index + 1).padStart(2, '0')
    if (row.numero !== expected) {
      problems.push(`campo ${row.numero} na posição de ${expected}`)
    }
    if (row.tipo !== 'C' && row.tipo !== 'N') {
      problems.push(`campo ${row.numero} com tipo "${row.tipo}"`)
    }
  })
  return problems
}
