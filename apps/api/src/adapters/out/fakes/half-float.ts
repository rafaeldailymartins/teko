/**
 * Vetores em float16 (IEEE 754 binary16), little-endian, em base64: o formato da fixture de
 * embeddings. É a mesma precisão do `halfvec` do pgvector, então guardar em float16 não perde nada
 * em relação ao que vai para o banco, e o arquivo fica 4 vezes menor que JSON com floats.
 *
 * Implementação própria porque o `lib` do TypeScript (es2024) ainda não tipa `Float16Array`.
 */

const FLOAT_VIEW = new DataView(new ArrayBuffer(4))

/** float32 → bits de float16, com arredondamento para o par mais próximo. */
export function toHalfBits(value: number): number {
  FLOAT_VIEW.setFloat32(0, value)
  const bits = FLOAT_VIEW.getUint32(0)
  const sign = (bits >>> 16) & 0x8000
  const exponent = (bits >>> 23) & 0xff
  let mantissa = bits & 0x7fffff
  if (exponent === 0xff) {
    // NaN ou infinito.
    return sign | 0x7c00 | (mantissa === 0 ? 0 : 0x200)
  }
  const halfExponent = exponent - 127 + 15
  if (halfExponent >= 0x1f) {
    return sign | 0x7c00
  }
  if (halfExponent <= 0) {
    if (halfExponent < -10) {
      return sign
    }
    mantissa |= 0x800000
    const shift = 14 - halfExponent
    const halfMantissa = mantissa >>> shift
    const remainder = mantissa & ((1 << shift) - 1)
    const halfway = 1 << (shift - 1)
    const roundUp = remainder > halfway || (remainder === halfway && (halfMantissa & 1) === 1)
    return sign | (halfMantissa + (roundUp ? 1 : 0))
  }
  const halfMantissa = mantissa >>> 13
  const remainder = mantissa & 0x1fff
  const roundUp = remainder > 0x1000 || (remainder === 0x1000 && (halfMantissa & 1) === 1)
  // O arredondamento pode transbordar a mantissa para o expoente (comportamento correto).
  return sign | ((halfExponent << 10) + halfMantissa + (roundUp ? 1 : 0))
}

/** Bits de float16 → número. */
export function fromHalfBits(half: number): number {
  const sign = half & 0x8000 ? -1 : 1
  const exponent = (half >>> 10) & 0x1f
  const mantissa = half & 0x3ff
  if (exponent === 0) {
    return sign * 2 ** -14 * (mantissa / 1024)
  }
  if (exponent === 0x1f) {
    return mantissa === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN
  }
  return sign * 2 ** (exponent - 15) * (1 + mantissa / 1024)
}

export function encodeHalfVector(vector: readonly number[]): string {
  const buffer = Buffer.alloc(vector.length * 2)
  for (const [index, value] of vector.entries()) {
    buffer.writeUInt16LE(toHalfBits(value), index * 2)
  }
  return buffer.toString('base64')
}

export function decodeHalfVector(encoded: string): number[] {
  const buffer = Buffer.from(encoded, 'base64')
  if (buffer.length % 2 !== 0) {
    throw new RangeError('vetor float16 com número ímpar de bytes')
  }
  const vector: number[] = []
  for (let offset = 0; offset < buffer.length; offset += 2) {
    vector.push(fromHalfBits(buffer.readUInt16LE(offset)))
  }
  return vector
}
