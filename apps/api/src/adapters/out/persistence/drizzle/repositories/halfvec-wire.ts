/**
 * `halfvec` pelo formato binário do pgvector (`halfvec_send`), para ler vetores do banco sem o
 * texto canônico: o texto de um `halfvec(1024)` do BGE-M3 tem ~12,7 KB, e o binário em base64,
 * ~2,8 KB. O que sai do Neon conta na transferência pública (5 GB/mês por projeto no Free).
 *
 * Formato do `halfvec_send` (pgvector): `dim` int16, `unused` int16 (0) e `dim` valores
 * half-precision, tudo big-endian. A conversão devolve o texto `[x1,x2,...]` que o `halfvec_in`
 * aceita, com cada valor na menor representação decimal que volta ao mesmo float4 (a mesma regra
 * do `halfvec_out`, que imprime o float4 do half); o vetor reconstruído é bit a bit o original.
 */

/** Expressão SQL que lê a coluna `halfvec` como base64 do binário (o `encode` quebra linhas). */
export function halfvecBase64Sql(column: string): string {
  return `encode(halfvec_send(${column}), 'base64')`
}

function halfToNumber(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1
  const exponent = (bits >> 10) & 0x1f
  const fraction = bits & 0x3ff
  if (exponent === 0x1f) {
    throw new RangeError('halfvec com NaN ou infinito')
  }
  if (exponent === 0) {
    return sign * fraction * 2 ** -24
  }
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15)
}

/** Menor decimal que volta ao mesmo float4 (todo half é exato em float4). */
function shortestFloat4(value: number): string {
  if (value === 0) {
    return Object.is(value, -0) ? '-0' : '0'
  }
  for (let precision = 1; precision < 9; precision += 1) {
    const candidate = Number(value.toPrecision(precision))
    if (Math.fround(candidate) === value) {
      return String(candidate)
    }
  }
  return String(Number(value.toPrecision(9)))
}

/** Base64 do `halfvec_send` → texto aceito pelo `halfvec_in`; `null` passa como `null`. */
export function halfvecTextFromBase64(base64: string | null): string | null {
  if (base64 === null) {
    return null
  }
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length < 4) {
    throw new RangeError('halfvec binário sem cabeçalho')
  }
  const dimensions = bytes.readInt16BE(0)
  if (bytes.readInt16BE(2) !== 0 || bytes.length !== 4 + 2 * dimensions) {
    throw new RangeError(
      `halfvec binário inconsistente: ${String(dimensions)} dimensões em ${String(bytes.length)} bytes`,
    )
  }
  const values: string[] = []
  for (let index = 0; index < dimensions; index += 1) {
    values.push(shortestFloat4(halfToNumber(bytes.readUInt16BE(4 + 2 * index))))
  }
  return `[${values.join(',')}]`
}
