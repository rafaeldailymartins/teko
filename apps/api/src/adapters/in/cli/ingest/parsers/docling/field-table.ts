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
