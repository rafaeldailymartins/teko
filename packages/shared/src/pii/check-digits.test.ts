import { fc, test } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import {
  accessKeyCheckDigit,
  cnpjCheckDigits,
  cpfCheckDigits,
  isValidAccessKey,
  isValidCnpj,
  isValidCpf,
} from './check-digits.ts'

const VALID_KEY = '52240311222333000181550010000123451123456780'

describe('CPF', () => {
  it('aceita CPF válido com e sem máscara', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true)
    expect(isValidCpf('52998224725')).toBe(true)
    expect(cpfCheckDigits('529982247')).toBe('25')
  })

  it('rejeita DV errado, tamanho errado e sequências repetidas', () => {
    expect(isValidCpf('529.982.247-26')).toBe(false)
    expect(isValidCpf('529.982.247-52')).toBe(false)
    expect(isValidCpf('5299822472')).toBe(false)
    expect(isValidCpf('111.111.111-11')).toBe(false)
    expect(isValidCpf('000.000.000-00')).toBe(false)
    expect(isValidCpf('529.982.247-2a')).toBe(false)
  })

  it('exige base de 9 dígitos para calcular o DV', () => {
    expect(() => cpfCheckDigits('12345678')).toThrow(RangeError)
  })

  test.prop([fc.stringMatching(/^\d{9}$/)])('base + DV calculado é sempre válido', (base) => {
    fc.pre(!/^(\d)\1+$/.test(base))
    expect(isValidCpf(base + cpfCheckDigits(base))).toBe(true)
  })

  test.prop([fc.stringMatching(/^\d{9}$/), fc.integer({ min: 1, max: 9 })])(
    'alterar um DV invalida o CPF',
    (base, delta) => {
      const dv = cpfCheckDigits(base)
      const wrong = `${dv[0]}${(Number(dv[1]) + delta) % 10}`
      expect(isValidCpf(base + wrong)).toBe(false)
    },
  )
})

describe('CNPJ', () => {
  it('aceita CNPJ numérico válido com e sem máscara', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true)
    expect(isValidCnpj('11222333000181')).toBe(true)
    expect(cnpjCheckDigits('112223330001')).toBe('81')
  })

  it('aceita o CNPJ alfanumérico do exemplo oficial da Receita', () => {
    expect(isValidCnpj('12.ABC.345/01DE-35')).toBe(true)
    expect(isValidCnpj('12ABC34501DE35')).toBe(true)
    expect(isValidCnpj('12.abc.345/01de-35')).toBe(true)
    expect(cnpjCheckDigits('12ABC34501DE')).toBe('35')
  })

  it('rejeita DV errado, letras no DV e sequências repetidas', () => {
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false)
    expect(isValidCnpj('12.ABC.345/01DE-36')).toBe(false)
    expect(isValidCnpj('12.ABC.345/01DE-3A')).toBe(false)
    expect(isValidCnpj('00.000.000/0000-00')).toBe(false)
    expect(isValidCnpj('1122233300018')).toBe(false)
  })

  it('exige base de 12 posições maiúsculas para calcular o DV', () => {
    expect(() => cnpjCheckDigits('12abc34501de')).toThrow(RangeError)
    expect(() => cnpjCheckDigits('12345')).toThrow(RangeError)
  })

  test.prop([fc.stringMatching(/^[A-Z0-9]{12}$/)])(
    'base + DV calculado é sempre válido',
    (base) => {
      fc.pre(!/^(.)\1+$/.test(base))
      expect(isValidCnpj(base + cnpjCheckDigits(base))).toBe(true)
    },
  )
})

describe('chave de acesso', () => {
  it('aceita chave válida com e sem espaços entre blocos', () => {
    expect(isValidAccessKey(VALID_KEY)).toBe(true)
    expect(isValidAccessKey(VALID_KEY.replace(/(\d{4})(?=\d)/g, '$1 '))).toBe(true)
    expect(accessKeyCheckDigit(VALID_KEY.slice(0, 43))).toBe('0')
  })

  it('rejeita DV errado, UF inexistente, mês inválido e tamanho errado', () => {
    expect(isValidAccessKey(`${VALID_KEY.slice(0, 43)}1`)).toBe(false)
    expect(isValidAccessKey(`99${VALID_KEY.slice(2)}`)).toBe(false)
    expect(isValidAccessKey(`5224${'13'}${VALID_KEY.slice(6)}`)).toBe(false)
    expect(isValidAccessKey(`5224${'00'}${VALID_KEY.slice(6)}`)).toBe(false)
    expect(isValidAccessKey(VALID_KEY.slice(1))).toBe(false)
  })

  it('exige 43 dígitos para calcular o DV', () => {
    expect(() => accessKeyCheckDigit('123')).toThrow(RangeError)
  })

  test.prop([fc.stringMatching(/^\d{37}$/)])('base com UF e mês válidos + DV é válida', (rest) => {
    const first43 = `522403${rest}`
    expect(isValidAccessKey(first43 + accessKeyCheckDigit(first43))).toBe(true)
  })
})
