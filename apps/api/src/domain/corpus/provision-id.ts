import { type Family, isFamily, jurisdictionOf } from './family.ts'

/**
 * Chave estável de dispositivo (`provisions.stable_key`). É imutável: uma renumeração muda o
 * rótulo exibido (`provision_labels`), nunca a chave. Formato canônico, com `:` para caber num
 * segmento de URL e a jurisdição como prefixo:
 *
 *     <jurisdição>:<família>(:<tipo>:<valor>)+
 *
 * Exemplos: `go:rcte:art:76:par:6:inc:II`, `br:efd-icms-ipi:reg:C170:campo:07`,
 * `br:efd-reinf:evt:R-2010:campo:vlrTotalBruto`, `go:tabelas-go:tab:5-1-1:cod:GO000001`.
 */

/** Tipos de segmento aceitos e o formato do valor de cada um. */
const SEGMENT_VALUE = {
  /** Artigo, com sufixo de letra opcional (`76`, `76-A`). */
  art: /^\d{1,4}(?:-[A-Z])?$/,
  /** Parágrafo (`1` a `99`, `unico`). */
  par: /^(?:\d{1,2}(?:-[A-Z])?|unico)$/,
  /** Inciso em algarismos romanos, com sufixo de letra opcional (`II`, `IV-A`). */
  inc: /^[IVXLC]{1,8}(?:-[A-Z])?$/,
  /** Alínea (`a`, `b-1`). */
  ali: /^[a-z](?:-\d{1,2})?$/,
  /** Item numerado (`1`, `2-1`). */
  item: /^\d{1,3}(?:-\d{1,3})*$/,
  /** Capítulo, seção e anexo (numeração romana ou arábica). */
  cap: /^[IVXLC\d]{1,8}(?:-[A-Z])?$/,
  sec: /^[IVXLC\d]{1,8}(?:-[A-Z])?$/,
  anexo: /^[IVXLC\d]{1,8}$/,
  /** Registro da EFD (`0000`, `C170`, `1400`). */
  reg: /^[0-9A-K]\d{3}$/,
  /** Campo: número de ordem com 2 dígitos (`07`) ou nome do leiaute XML (`vlrTotalBruto`). */
  campo: /^(?:\d{2,3}|[a-z][A-Za-z0-9]{1,40})$/,
  /** Evento da EFD-REINF (`R-2010`). */
  evt: /^R-\d{4}$/,
  /** Grupo do leiaute (`infoServTom`). */
  grupo: /^[a-z][A-Za-z0-9]{1,40}$/,
  /** Tabela (`5-1-1`). */
  tab: /^\d{1,2}(?:-\d{1,2}){0,3}$/,
  /** Código de tabela (`GO000001`, `GO10`). */
  cod: /^[A-Z0-9]{1,12}$/,
} as const satisfies Record<string, RegExp>

type SegmentKind = keyof typeof SEGMENT_VALUE

export interface StableKeySegment {
  readonly kind: SegmentKind
  readonly value: string
}

export interface ParsedStableKey {
  readonly jurisdiction: 'br' | 'go'
  readonly family: Family
  readonly segments: readonly StableKeySegment[]
}

/** Tamanho máximo, o mesmo de `stableKeySchema` em `@teko/shared/contracts`. */
export const STABLE_KEY_MAX_LENGTH = 200

export class InvalidStableKeyError extends Error {
  readonly key: string

  constructor(key: string, reason: string) {
    super(`stable_key inválida (${reason}): ${JSON.stringify(key)}`)
    this.name = 'InvalidStableKeyError'
    this.key = key
  }
}

function isSegmentKind(value: string): value is SegmentKind {
  return Object.hasOwn(SEGMENT_VALUE, value)
}

/** Lê e valida a chave; lança `InvalidStableKeyError` com o motivo. */
export function parseStableKey(key: string): ParsedStableKey {
  if (key.length > STABLE_KEY_MAX_LENGTH) {
    throw new InvalidStableKeyError(key, 'longa demais')
  }
  const [jurisdiction, family, ...rest] = key.split(':')
  if (jurisdiction !== 'br' && jurisdiction !== 'go') {
    throw new InvalidStableKeyError(key, 'jurisdição deve ser br ou go')
  }
  if (!isFamily(family)) {
    throw new InvalidStableKeyError(key, 'família desconhecida')
  }
  if (jurisdictionOf(family).toLowerCase() !== jurisdiction) {
    throw new InvalidStableKeyError(key, 'jurisdição não corresponde à família')
  }
  if (rest.length === 0 || rest.length % 2 !== 0) {
    throw new InvalidStableKeyError(key, 'segmentos devem vir em pares tipo:valor')
  }
  const segments: StableKeySegment[] = []
  for (let index = 0; index < rest.length; index += 2) {
    const kind = rest[index] ?? ''
    const value = rest[index + 1] ?? ''
    if (!isSegmentKind(kind)) {
      throw new InvalidStableKeyError(key, `tipo de segmento desconhecido: ${kind}`)
    }
    if (!SEGMENT_VALUE[kind].test(value)) {
      throw new InvalidStableKeyError(key, `valor inválido para ${kind}: ${value}`)
    }
    segments.push(Object.freeze({ kind, value }))
  }
  return Object.freeze({ jurisdiction, family, segments: Object.freeze(segments) })
}

export function isStableKey(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }
  try {
    parseStableKey(value)
    return true
  } catch {
    return false
  }
}

/** Monta a chave a partir da família e dos segmentos (validando o resultado). */
export function buildStableKey(family: Family, segments: readonly StableKeySegment[]): string {
  const prefix = `${jurisdictionOf(family).toLowerCase()}:${family}`
  const key = [prefix, ...segments.map(({ kind, value }) => `${kind}:${value}`)].join(':')
  parseStableKey(key)
  return key
}

/** Chave do dispositivo pai (sem o último segmento); `null` para o primeiro nível. */
export function parentStableKey(key: string): string | null {
  const parsed = parseStableKey(key)
  if (parsed.segments.length <= 1) {
    return null
  }
  return buildStableKey(parsed.family, parsed.segments.slice(0, -1))
}

/** `ancestor` é a própria chave ou um prefixo de segmentos completos dela. */
export function isSameOrDescendant(key: string, ancestor: string): boolean {
  return key === ancestor || key.startsWith(`${ancestor}:`)
}
