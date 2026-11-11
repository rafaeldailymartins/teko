import { fc, test } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { cnpjCheckDigits, cpfCheckDigits } from './check-digits.ts'
import {
  containsPii,
  createPiiPattern,
  PII_KINDS,
  PII_PATTERN_FLAGS,
  PII_PATTERN_SOURCES,
  PII_PLACEHOLDERS,
  PiiKind,
  redact,
} from './redact.ts'

const VALID_KEY = '52240311222333000181550010000123451123456780'
const zero = { email: 0, nfe_key: 0, cnpj: 0, cpf: 0, phone: 0 }

describe('redact: identificadores com DV', () => {
  it('redige CPF com e sem máscara', () => {
    const result = redact('Meu CPF é 529.982.247-25 e o da empresa 52998224725.')
    expect(result.text).toBe('Meu CPF é [CPF] e o da empresa [CPF].')
    expect(result.counts).toEqual({ ...zero, cpf: 2 })
    expect(result.total).toBe(2)
  })

  it('redige CNPJ numérico e alfanumérico', () => {
    const result = redact(
      'Emitente 11.222.333/0001-81, destinatário 12.ABC.345/01DE-35 e filial 12ABC34501DE35.',
    )
    expect(result.text).toBe('Emitente [CNPJ], destinatário [CNPJ] e filial [CNPJ].')
    expect(result.counts.cnpj).toBe(3)
  })

  it('redige a chave de acesso inteira antes do CNPJ que ela contém', () => {
    const spaced = VALID_KEY.replace(/(\d{4})(?=\d)/g, '$1 ')
    const result = redact(`Chave ${VALID_KEY} e no DANFE: ${spaced}`)
    expect(result.text).toBe('Chave [CHAVE_NFE] e no DANFE: [CHAVE_NFE]')
    expect(result.counts).toEqual({ ...zero, nfe_key: 2 })
  })

  it('não redige identificadores com DV inválido', () => {
    const text =
      'CPF 529.982.247-26, CNPJ 11.222.333/0001-82, chave 52240311222333000181550010000123451123456781'
    expect(redact(text)).toEqual({ text, counts: zero, total: 0 })
  })

  it('só aceita CNPJ alfanumérico sem máscara em maiúsculas', () => {
    expect(redact('código 12abc34501de35').total).toBe(0)
    expect(redact('código 12.abc.345/01de-35').text).toBe('código [CNPJ]')
  })
})

describe('redact: e-mail e telefone', () => {
  it('redige e-mails', () => {
    const result = redact('Escreva para fulano.silva+nfe@empresa.com.br ou a@b.io.')
    expect(result.text).toBe('Escreva para [EMAIL] ou [EMAIL].')
    expect(result.counts.email).toBe(2)
  })

  it.each([
    '(62) 99999-8888',
    '(62)3201-5000',
    '+55 (62) 99999-8888',
    '55 (11) 3333-4444',
    '+55 62 99999-8888',
    '+5562999998888',
    '62 99999-8888',
    '62 9 9999-8888',
    '(62) 9 9999-8888',
    '62.99999.8888',
    '99999-8888',
  ])('redige o telefone %j', (phone) => {
    const result = redact(`Ligue ${phone} hoje`)
    expect(result.text).toBe('Ligue [TELEFONE] hoje')
    expect(result.counts.phone).toBe(1)
  })

  it('não redige telefone com DDD inexistente', () => {
    expect(redact('(20) 99999-8888').total).toBe(0)
    expect(redact('+55 10 99999-8888').total).toBe(0)
    expect(redact('23 99999-8888').total).toBe(0)
    expect(redact('20 3201-5000').total).toBe(0)
  })

  it.each(['62 3201-5000', '11 3333-4444', '62 3201 5000', '62.3201.5000', '623201-5000'])(
    'redige o fixo com DDD sem parênteses %j',
    (phone) => {
      const result = redact(`Fixo ${phone} hoje`)
      expect(result.text).toBe('Fixo [TELEFONE] hoje')
      expect(result.counts.phone).toBe(1)
    },
  )

  // Fixo sem DDD fica FORA do escopo de propósito: "[2-5]\d{3}-\d{4}" casaria faixas de anos
  // ("2024-2025", "2023-2024"), onipresentes no texto fiscal. Pelo mesmo motivo, o fixo com DDD
  // sem parênteses cujos 8 dígitos formam uma faixa de anos ("21 2024-2025") não é redigido.
  it.each([
    'Fixo 3201-5000 hoje',
    'período 2024-2025',
    'tabela 21 2024-2025',
    'anexo 11 1999-2000',
    'código 212024-2025',
    'fixo 62 32015000 sem separador',
  ])('não redige fixo sem DDD nem faixa de anos %j', (text) => {
    expect(redact(text)).toEqual({ text, counts: zero, total: 0 })
  })

  // A exceção da faixa de anos vale só para "DD NNNN-NNNN": com parênteses ou +55 o formato já
  // é inequívoco.
  it.each(['(21) 2024-2025', '(21)2024-2025', '+55 21 2024-2025'])(
    'redige o fixo com DDD explícito mesmo com dígitos de ano %j',
    (phone) => {
      expect(redact(`Fixo ${phone} hoje`).text).toBe('Fixo [TELEFONE] hoje')
    },
  )
})

describe('redact: listas separadas por "/"', () => {
  it.each([
    ['Cel 99999-8888/98888-7777', 'Cel [TELEFONE]/[TELEFONE]'],
    ['Fones (62) 99999-8888/(62) 98888-7777', 'Fones [TELEFONE]/[TELEFONE]'],
    ['3201-5000/99999-8888', '3201-5000/[TELEFONE]'],
    ['CNPJs 11.222.333/0001-81/11.444.777/0001-61', 'CNPJs [CNPJ]/[CNPJ]'],
    ['CPF 529.982.247-25/2024', 'CPF [CPF]/2024'],
    ['CPF/CNPJ 529.982.247-25/11.222.333/0001-81', 'CPF/CNPJ [CPF]/[CNPJ]'],
    ['CPF 52998224725/11222333000181', 'CPF [CPF]/[CNPJ]'],
    ['CPFs 529.982.247-25/111.444.777-35', 'CPFs [CPF]/[CPF]'],
  ])('redige cada item de %j', (text, expected) => {
    expect(redact(text).text).toBe(expected)
  })

  it('continua sem redigir CPF dentro de número maior com ponto', () => {
    expect(redact('1.529.982.247-25').total).toBe(0)
    expect(redact('529.982.247-25.1').total).toBe(0)
    expect(redact('529.982.247-25-1').total).toBe(0)
  })
})

describe('redact: chave de acesso no atributo Id do XML', () => {
  it.each(['NFe', 'CTe', 'MDFe', 'CFe', 'BPe', 'NF3e', 'NFCom'])(
    'redige a chave com prefixo %s e mantém o prefixo',
    (prefix) => {
      const result = redact(`<inf Id="${prefix}${VALID_KEY}" versao="4.00">`)
      expect(result.text).toBe(`<inf Id="${prefix}[CHAVE_NFE]" versao="4.00">`)
      expect(result.counts).toEqual({ ...zero, nfe_key: 1 })
    },
  )

  it('redige a chave colada em "NFe" no texto livre', () => {
    expect(redact(`chave NFe${VALID_KEY}`).text).toBe('chave NFe[CHAVE_NFE]')
  })

  it('não aceita prefixo arbitrário de letras nem prefixo colado em outra palavra', () => {
    expect(redact(`ABC${VALID_KEY}`).total).toBe(0)
    expect(redact(`xNFe${VALID_KEY}`).total).toBe(0)
  })
})

describe('redact: e-mail com acentos', () => {
  it.each([
    ['Contato: maria.joão@empresa.com.br', 'Contato: [EMAIL]'],
    ['Contato: josé.silva@gmail.com', 'Contato: [EMAIL]'],
    ['Contato: renée@x.com.br', 'Contato: [EMAIL]'],
    ['Contato: josé@x.com', 'Contato: [EMAIL]'],
    ['Contato: contato@ação.com.br.', 'Contato: [EMAIL].'],
  ])('redige o endereço inteiro em %j', (text, expected) => {
    const result = redact(text)
    expect(result.text).toBe(expected)
    expect(result.counts.email).toBe(1)
  })
})

describe('redact: falsos positivos fiscais', () => {
  it.each([
    'Como preencher o registro C170 campo 07 da EFD ICMS/IPI?',
    'Registro 0150, campo 02; registro E110 campo 13; bloco 9 registro 9999.',
    'stableKey br:efd-icms-ipi:reg:C170:campo:07 e go:rcte:art:76:par:6:inc:II',
    'CFOP 5102, 6102 e 5405; CST 060; NCM 8471.30.12; CEST 01.001.00',
    'Valor de R$ 1.234.567,89 com alíquota de 17% no período 2024-2025.',
    'Datas 01/03/2024, 2024-03-01 e PA 03/2024; Decreto nº 4.852/1997, art. 76, § 6º.',
    'Ato COTEPE/ICMS 44/2018 e Lei 12.973/2014; IN RFB 2.229/2024.',
    'CEP 74000-000; processo 5012345-67.2023.8.09.0051.',
    'COD_ITEM 12345678901 e NUM_DOC 000012345 da série 001.',
    'Inscrição estadual 10.123.456-7 e código de barras 7891234567895.',
    'Leiaute 3.1.6 do Guia Prático versão 3.2.4, tabela 4.3.1.',
    'Número aleatório de 14 dígitos 12345678901234 e de 44 dígitos 12345678901234567890123456789012345678901234.',
  ])('mantém %j', (text) => {
    expect(redact(text)).toEqual({ text, counts: zero, total: 0 })
  })

  it('não redige um CPF válido colado em outros dígitos ou dentro de número maior', () => {
    expect(redact('NUM 0052998224725').total).toBe(0)
    expect(redact('1.529.982.247-25').total).toBe(0)
    expect(redact('ID52998224725').total).toBe(0)
  })
})

describe('redact: opções e propriedades', () => {
  it('restringe os tipos redigidos', () => {
    const result = redact('529.982.247-25 fulano@x.com', { kinds: [PiiKind.Email] })
    expect(result.text).toBe('529.982.247-25 [EMAIL]')
    expect(result.counts).toEqual({ ...zero, email: 1 })
  })

  it('detecta presença de PII', () => {
    expect(containsPii('meu e-mail é a@b.com')).toBe(true)
    expect(containsPii('registro C170 campo 07')).toBe(false)
  })

  it('expõe marcadores, ordem e regex frescas', () => {
    expect(PII_KINDS).toEqual(['email', 'nfe_key', 'cnpj', 'cpf', 'phone'])
    for (const kind of PII_KINDS) {
      expect(PII_PLACEHOLDERS[kind]).not.toMatch(/\d/)
      const pattern = createPiiPattern(kind)
      expect(pattern.flags).toBe('gu')
      expect(pattern.flags).toBe(PII_PATTERN_FLAGS)
      expect(pattern.source).toBe(new RegExp(PII_PATTERN_SOURCES[kind], 'u').source)
      expect(createPiiPattern(kind)).not.toBe(pattern)
    }
  })

  const cpfArb = fc
    .stringMatching(/^\d{9}$/)
    .filter((base) => !/^(\d)\1+$/.test(base))
    .chain((base) =>
      fc.boolean().map((masked) => {
        const raw = base + cpfCheckDigits(base)
        return masked ? raw.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : raw
      }),
    )

  const cnpjArb = fc
    .stringMatching(/^[A-Z0-9]{12}$/)
    .filter((base) => !/^(.)\1+$/.test(base))
    .map((base) => {
      const raw = base + cnpjCheckDigits(base)
      return raw.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, '$1.$2.$3/$4-$5')
    })

  const fillerArb = fc.constantFrom('', ' ', 'Olá, ', 'registro C170 campo 07: ', '\n', '(')

  test.prop([fillerArb, cpfArb, fillerArb])('todo CPF válido é redigido', (before, cpf, after) => {
    const result = redact(`${before}${cpf} ${after}`)
    expect(result.counts.cpf).toBe(1)
    expect(result.text).toBe(`${before}[CPF] ${after}`)
  })

  test.prop([fillerArb, cnpjArb, fillerArb])(
    'todo CNPJ válido é redigido',
    (before, cnpj, after) => {
      const result = redact(`${before}${cnpj} ${after}`)
      expect(result.counts.cnpj).toBe(1)
      expect(result.text).toBe(`${before}[CNPJ] ${after}`)
    },
  )

  const ddd = fc.constantFrom('11', '21', '31', '61', '62', '71', '85', '99')
  const fourDigits = fc.stringMatching(/^\d{4}$/)
  const phoneArb = fc
    .record({
      ddd,
      head: fourDigits,
      tail: fourDigits,
      format: fc.constantFrom('paren', 'bare', 'plus', 'none'),
    })
    .map(({ ddd: code, head, tail, format }) => {
      const number = `9${head}-${tail}`
      if (format === 'paren') {
        return `(${code}) ${number}`
      }
      if (format === 'bare') {
        return `${code} ${number}`
      }
      return format === 'plus' ? `+55 ${code} ${number}` : number
    })

  const identifierArb = fc.oneof(
    cpfArb.map((value) => ({ value, placeholder: '[CPF]' })),
    cnpjArb.map((value) => ({ value, placeholder: '[CNPJ]' })),
    phoneArb.map((value) => ({ value, placeholder: '[TELEFONE]' })),
  )

  test.prop([fc.array(identifierArb, { minLength: 2, maxLength: 4 }), fillerArb])(
    'identificadores válidos unidos por "/" são todos redigidos',
    (items, before) => {
      const text = `${before}${items.map((item) => item.value).join('/')} fim`
      const result = redact(text)
      expect(result.text).toBe(`${before}${items.map((item) => item.placeholder).join('/')} fim`)
      expect(result.total).toBe(items.length)
    },
  )

  test.prop([fc.string({ maxLength: 200 })])('é idempotente', (text) => {
    const once = redact(text).text
    expect(redact(once).text).toBe(once)
  })

  test.prop([fc.string({ maxLength: 200 })])('total é a soma das contagens', (text) => {
    const { counts, total } = redact(text)
    expect(total).toBe(Object.values(counts).reduce((sum, value) => sum + value, 0))
  })
})
