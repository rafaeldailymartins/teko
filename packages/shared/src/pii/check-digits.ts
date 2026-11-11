/**
 * Validação de dígitos verificadores (DV) de CPF, CNPJ (numérico e alfanumérico) e chave de
 * acesso de documentos fiscais eletrônicos (NF-e/NFC-e/CT-e, 44 dígitos).
 *
 * O DV é o que separa um identificador real de uma sequência qualquer de dígitos (número de
 * registro, campo, código de item), evitando falsos positivos na redação de PII.
 */

function mod11CheckDigit(values: readonly number[], weights: readonly number[]): number {
  let sum = 0
  values.forEach((value, index) => {
    sum += value * Number(weights[index])
  })
  const remainder = sum % 11
  return remainder < 2 ? 0 : 11 - remainder
}

function digitsOf(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0) - 48)
}

const isRepeatedChar = (text: string): boolean => /^(.)\1*$/.test(text)

// ---------------------------------------------------------------------------------------------
// CPF: 9 dígitos de base + 2 DV, pesos 10..2 e 11..2.

const CPF_WEIGHTS_1 = [10, 9, 8, 7, 6, 5, 4, 3, 2]
const CPF_WEIGHTS_2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]

/** Os dois DV de uma base de 9 dígitos. */
export function cpfCheckDigits(base: string): string {
  if (!/^\d{9}$/.test(base)) {
    throw new RangeError('A base do CPF deve ter 9 dígitos')
  }
  const digits = digitsOf(base)
  const first = mod11CheckDigit(digits, CPF_WEIGHTS_1)
  const second = mod11CheckDigit([...digits, first], CPF_WEIGHTS_2)
  return `${first}${second}`
}

/** CPF com ou sem máscara (`000.000.000-00`). Sequências repetidas (111.111.111-11) são inválidas. */
export function isValidCpf(value: string): boolean {
  const cpf = value.replace(/[.\-\s]/g, '')
  if (!/^\d{11}$/.test(cpf) || isRepeatedChar(cpf)) {
    return false
  }
  return cpfCheckDigits(cpf.slice(0, 9)) === cpf.slice(9)
}

// ---------------------------------------------------------------------------------------------
// CNPJ: 12 posições de base + 2 DV. Desde julho de 2026 (IN RFB 2.229/2024) a base pode ser
// alfanumérica (A–Z e 0–9); o DV continua numérico. O valor de cada caractere é o código ASCII
// menos 48 (0–9 → 0–9, A → 17, ..., Z → 42), o que mantém o cálculo antigo para CNPJ numérico.

const CNPJ_WEIGHTS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
const CNPJ_WEIGHTS_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]

/** Os dois DV de uma base de 12 posições (dígitos ou letras maiúsculas). */
export function cnpjCheckDigits(base: string): string {
  if (!/^[A-Z0-9]{12}$/.test(base)) {
    throw new RangeError('A base do CNPJ deve ter 12 posições alfanuméricas maiúsculas')
  }
  const values = digitsOf(base)
  const first = mod11CheckDigit(values, CNPJ_WEIGHTS_1)
  const second = mod11CheckDigit([...values, first], CNPJ_WEIGHTS_2)
  return `${first}${second}`
}

/**
 * CNPJ numérico ou alfanumérico, com ou sem máscara (`00.000.000/0000-00`). Letras minúsculas
 * são aceitas e normalizadas. Sequências repetidas (00.000.000/0000-00) são inválidas.
 */
export function isValidCnpj(value: string): boolean {
  const cnpj = value.replace(/[./\-\s]/g, '').toUpperCase()
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) || isRepeatedChar(cnpj)) {
    return false
  }
  return cnpjCheckDigits(cnpj.slice(0, 12)) === cnpj.slice(12)
}

// ---------------------------------------------------------------------------------------------
// Chave de acesso (NF-e modelo 55, NFC-e 65, CT-e 57 etc.): 44 dígitos =
// cUF(2) AAMM(4) CNPJ/CPF(14) mod(2) série(3) nNF(9) tpEmis(1) cNF(8) cDV(1).
// DV por módulo 11 com pesos 2..9 da direita para a esquerda.

/** Códigos IBGE das UFs válidos em `cUF`. */
const UF_CODES = new Set([
  11, 12, 13, 14, 15, 16, 17, 21, 22, 23, 24, 25, 26, 27, 28, 29, 31, 32, 33, 35, 41, 42, 43, 50,
  51, 52, 53,
])

/** DV de uma chave a partir das 43 primeiras posições. */
export function accessKeyCheckDigit(first43: string): string {
  if (!/^\d{43}$/.test(first43)) {
    throw new RangeError('A chave de acesso sem DV deve ter 43 dígitos')
  }
  const digits = digitsOf(first43).reverse()
  const weights = digits.map((_, index) => (index % 8) + 2)
  return String(mod11CheckDigit(digits, weights))
}

/**
 * Chave de acesso de 44 dígitos (espaços e pontos entre os blocos são ignorados). Além do DV,
 * confere a UF (`cUF`) e o mês de emissão (`AAMM`), o que derruba quase todo falso positivo.
 */
export function isValidAccessKey(value: string): boolean {
  const key = value.replace(/[.\s]/g, '')
  if (!/^\d{44}$/.test(key)) {
    return false
  }
  const uf = Number(key.slice(0, 2))
  const month = Number(key.slice(4, 6))
  if (!UF_CODES.has(uf) || month < 1 || month > 12) {
    return false
  }
  return accessKeyCheckDigit(key.slice(0, 43)) === key.slice(43)
}
