import { isValidAccessKey, isValidCnpj, isValidCpf } from './check-digits.ts'

/**
 * Redação de PII em texto livre (perguntas antes de persistir, mensagens de log). É a fonte única
 * das regex usadas pelo `PiiRedactor` da API.
 *
 * Critério: na dúvida entre um identificador real e um número fiscal comum (registro `0150`,
 * campo `07`, CFOP, NCM, valores, datas, anos), o número fiscal NÃO é redigido. Por isso CPF,
 * CNPJ e chave de acesso só são redigidos com DV válido, e telefone exige formatação típica
 * (DDD entre parênteses, `+55` ou separador antes dos 4 últimos dígitos) e DDD existente.
 *
 * Escopo do telefone:
 * - celular (`9xxxx-xxxx`) com ou sem DDD;
 * - fixo (`[2-5]xxx-xxxx`) só com DDD: `(62) 3201-5000`, `+55 62 3201-5000`, `62 3201-5000`.
 *   O fixo com DDD sem parênteses nem `+55` não é redigido quando os 8 dígitos formam uma faixa
 *   de anos (`21 2024-2025`);
 * - fixo SEM DDD (`3201-5000`) fica fora de propósito: `[2-5]\d{3}-\d{4}` casaria faixas de anos
 *   (`2024-2025`, `2023-2024`), onipresentes no texto fiscal, e não haveria DDD para validar.
 *
 * `/` é separador de lista (`99999-8888/98888-7777`, `CPF/CNPJ x/y`) e não impede a redação dos
 * vizinhos. Já `.` antes e `.`/`-` + dígito depois indicam número maior (`1.529.982.247-25`),
 * que não é redigido.
 */

export const PiiKind = {
  Email: 'email',
  AccessKey: 'nfe_key',
  Cnpj: 'cnpj',
  Cpf: 'cpf',
  Phone: 'phone',
} as const

export type PiiKind = (typeof PiiKind)[keyof typeof PiiKind]

/** Ordem de aplicação: do padrão mais longo/específico para o mais curto. */
export const PII_KINDS: readonly PiiKind[] = [
  PiiKind.Email,
  PiiKind.AccessKey,
  PiiKind.Cnpj,
  PiiKind.Cpf,
  PiiKind.Phone,
]

/** Marcadores que substituem cada tipo de PII; não contêm dígitos, então não são re-redigidos. */
export const PII_PLACEHOLDERS: Readonly<Record<PiiKind, string>> = {
  email: '[EMAIL]',
  nfe_key: '[CHAVE_NFE]',
  cnpj: '[CNPJ]',
  cpf: '[CPF]',
  phone: '[TELEFONE]',
}

// Fronteiras: não começar nem terminar no meio de outro número/palavra (inclui "1.234.567").
// `/` fica de fora de propósito: é separador de lista ("x/y"), não parte de um número maior.
const START = String.raw`(?<![\dA-Za-z_.])`
const END = String.raw`(?![\dA-Za-z_]|[.-]\d)`
const MOBILE_OR_LANDLINE = String.raw`(?:9[\s.]?\d{4}|[2-5]\d{3})[\s.-]?\d{4}`
/** Prefixo do atributo `Id` no XML dos DF-e (`Id="NFe<44 dígitos>"`); a NFC-e também usa `NFe`. */
const ACCESS_KEY_PREFIX = '(?<=(?<![A-Za-z])(?:NFe|CTe|MDFe|CFe|BPe|NF3e|NFCom))'
/** Caracteres de e-mail além do ASCII (`maria.joão@`, `josé@`, domínio IDN); exige a flag `u`. */
const EMAIL_CHAR = String.raw`\p{L}\p{M}\p{N}`

/** Flags com que as fontes devem ser compiladas; `u` é obrigatória (o e-mail usa `\p{L}`). */
export const PII_PATTERN_FLAGS = 'gu'

/** Fontes das regex (sem flags; compile com `PII_PATTERN_FLAGS`). Prefira `createPiiPattern`. */
export const PII_PATTERN_SOURCES: Readonly<Record<PiiKind, string>> = {
  email: String.raw`(?<![${EMAIL_CHAR}_.%+-])[${EMAIL_CHAR}._%+-]+@(?:[${EMAIL_CHAR}-]+\.)+[\p{L}\p{M}]{2,}(?![${EMAIL_CHAR}_-])`,
  nfe_key: String.raw`(?:${START}|${ACCESS_KEY_PREFIX})\d{4}(?:[ .]?\d{4}){10}${END}`,
  cnpj: String.raw`${START}[A-Za-z0-9]{2}\.?[A-Za-z0-9]{3}\.?[A-Za-z0-9]{3}\/?[A-Za-z0-9]{4}-?\d{2}${END}`,
  cpf: String.raw`${START}\d{3}\.?\d{3}\.?\d{3}-?\d{2}${END}`,
  phone: [
    String.raw`(?<![\dA-Za-z_+.])(?:`,
    // (62) 99999-9999, +55 (62) 3201-5000
    String.raw`(?:\+?55[\s.-]?)?\(\d{2}\)\s?${MOBILE_OR_LANDLINE}`,
    // +55 62 99999-9999, +5562999999999
    String.raw`|\+55[\s.-]?\d{2}[\s.-]?${MOBILE_OR_LANDLINE}`,
    // 62 99999-9999, 62 9 9999-9999 (celular com DDD, separador obrigatório no fim)
    String.raw`|\d{2}[\s.-]?9[\s.]?\d{4}[\s.-]\d{4}`,
    // 62 3201-5000 (fixo com DDD, separador obrigatório no fim; faixa de anos é descartada)
    String.raw`|\d{2}[\s.-]?[2-5]\d{3}[\s.-]\d{4}`,
    // 99999-9999 (celular sem DDD)
    String.raw`|9\d{4}-\d{4}`,
    String.raw`)(?!\d)`,
  ].join(''),
}

/** Nova instância (flags `PII_PATTERN_FLAGS`) da regex do tipo pedido; nunca compartilhe `lastIndex`. */
export function createPiiPattern(kind: PiiKind): RegExp {
  return new RegExp(PII_PATTERN_SOURCES[kind], PII_PATTERN_FLAGS)
}

/** DDDs em uso no Brasil (Anatel). */
const VALID_DDD = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43,
  44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77,
  79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
])

function phoneDdd(match: string): number | undefined {
  const digits = match.replace(/\D/g, '')
  if (match.startsWith('+')) {
    return Number(digits.slice(2, 4))
  }
  const paren = match.indexOf('(')
  if (paren >= 0) {
    return Number(match.slice(paren + 1, paren + 3))
  }
  return digits.length >= 10 ? Number(digits.slice(0, 2)) : undefined
}

/**
 * `2024-2025`, `1999 2000`: dois anos de 4 dígitos, não os 8 dígitos de um fixo. Aplicada só ao
 * fixo com DDD sem parênteses (`DD NNNN-NNNN`), cujo único trecho "4 dígitos + separador +
 * 4 dígitos" é o próprio número.
 */
const YEAR_RANGE = /(?:19|20)\d{2}\D(?:19|20)\d{2}/

/** Fixo com DDD sem parênteses nem `+55` (`62 3201-5000`): a forma que colide com faixas de anos. */
const BARE_DDD_LANDLINE = /^\d{2}\D?[2-5]/

function isValidPhone(match: string): boolean {
  if (BARE_DDD_LANDLINE.test(match) && YEAR_RANGE.test(match)) {
    return false
  }
  const ddd = phoneDdd(match)
  return ddd === undefined || VALID_DDD.has(ddd)
}

/** CNPJ sem máscara só conta em maiúsculas: evita confundir palavras/códigos com CNPJ alfanumérico. */
function isLikelyCnpj(match: string): boolean {
  const masked = /[./-]/.test(match)
  return (masked || /^[A-Z0-9]+$/.test(match)) && isValidCnpj(match)
}

const VALIDATORS: Readonly<Record<PiiKind, (match: string) => boolean>> = {
  email: () => true,
  nfe_key: isValidAccessKey,
  cnpj: isLikelyCnpj,
  cpf: isValidCpf,
  phone: isValidPhone,
}

export type PiiCounts = Readonly<Record<PiiKind, number>>

export interface RedactionResult {
  /** Texto com cada ocorrência trocada pelo marcador do tipo (ex.: `[CPF]`). */
  readonly text: string
  /** Quantidade de ocorrências redigidas por tipo. */
  readonly counts: PiiCounts
  readonly total: number
}

export interface RedactOptions {
  /** Restringe os tipos redigidos (padrão: todos). A ordem de aplicação é sempre `PII_KINDS`. */
  readonly kinds?: readonly PiiKind[]
}

export function redact(text: string, options: RedactOptions = {}): RedactionResult {
  const enabled = new Set(options.kinds ?? PII_KINDS)
  const counts: Record<PiiKind, number> = { email: 0, nfe_key: 0, cnpj: 0, cpf: 0, phone: 0 }
  let output = text
  for (const kind of PII_KINDS) {
    if (enabled.has(kind)) {
      output = output.replace(createPiiPattern(kind), (match) => {
        if (!VALIDATORS[kind](match)) {
          return match
        }
        counts[kind] += 1
        return PII_PLACEHOLDERS[kind]
      })
    }
  }
  const total = PII_KINDS.reduce((sum, kind) => sum + counts[kind], 0)
  return { text: output, counts, total }
}

/** `true` se o texto contém ao menos uma ocorrência de PII reconhecida. */
export function containsPii(text: string): boolean {
  return redact(text).total > 0
}
