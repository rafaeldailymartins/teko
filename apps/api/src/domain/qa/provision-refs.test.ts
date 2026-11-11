import { describe, expect, it } from 'vitest'
import { extractProvisionRefs } from './provision-refs.ts'

describe('extractProvisionRefs', () => {
  it('artigo e parágrafo: da chave mais específica para a mais geral, em RCTE e CTE', () => {
    expect(extractProvisionRefs('O que diz o art. 76, § 6º?')).toEqual([
      'go:rcte:art:76:par:6',
      'go:rcte:art:76',
      'go:cte:art:76:par:6',
      'go:cte:art:76',
    ])
  })

  it('a menção à norma escolhe a família, acima das famílias pedidas', () => {
    expect(extractProvisionRefs('art. 76, § 6º do RCTE', ['cte'])).toEqual([
      'go:rcte:art:76:par:6',
      'go:rcte:art:76',
    ])
    expect(extractProvisionRefs('no Regulamento do Código Tributário, artigo 12', ['cte'])).toEqual(
      ['go:rcte:art:12'],
    )
    expect(extractProvisionRefs('Código Tributário do Estado, art. 44')).toEqual(['go:cte:art:44'])
    expect(extractProvisionRefs('art. 5 do CTE')).toEqual(['go:cte:art:5'])
  })

  it('sem menção, usa só as famílias pedidas que têm artigos', () => {
    expect(extractProvisionRefs('art. 76', ['cte'])).toEqual(['go:cte:art:76'])
    expect(extractProvisionRefs('art. 76', ['efd-icms-ipi'])).toEqual([])
  })

  it('inciso, alínea, sufixo de letra e parágrafo único', () => {
    expect(extractProvisionRefs('art 5º, inciso II, alínea b', ['rcte'])).toEqual([
      'go:rcte:art:5:inc:II:ali:b',
      'go:rcte:art:5:inc:II',
      'go:rcte:art:5',
    ])
    expect(extractProvisionRefs('Art. 76, § 5º, inc. I', ['rcte'])).toEqual([
      'go:rcte:art:76:par:5:inc:I',
      'go:rcte:art:76:par:5',
      'go:rcte:art:76',
    ])
    expect(extractProvisionRefs('artigo 76-A, parágrafo único', ['rcte'])).toEqual([
      'go:rcte:art:76-A:par:unico',
      'go:rcte:art:76-A',
    ])
    expect(extractProvisionRefs('art. 3º, § 01', ['rcte'])).toEqual([
      'go:rcte:art:3:par:1',
      'go:rcte:art:3',
    ])
  })

  it('ordem natural: "§ 6º do art. 76", "parágrafo único do artigo 5-A"', () => {
    expect(extractProvisionRefs('O § 6º do art. 76 do RCTE valia em 2006?', ['cte'])).toEqual([
      'go:rcte:art:76:par:6',
      'go:rcte:art:76',
    ])
    expect(extractProvisionRefs('parágrafo único do artigo 5-a', ['cte'])).toEqual([
      'go:cte:art:5-A:par:unico',
      'go:cte:art:5-A',
    ])
    expect(extractProvisionRefs('§ 2º ao art. 9', ['rcte'])).toEqual([
      'go:rcte:art:9:par:2',
      'go:rcte:art:9',
    ])
  })

  it('registro e campo da EFD, nas famílias de registros pedidas', () => {
    expect(extractProvisionRefs('Registro C170, campo 7')).toEqual([
      'br:efd-icms-ipi:reg:C170:campo:07',
      'br:efd-icms-ipi:reg:C170',
      'go:efd-go:reg:C170:campo:07',
      'go:efd-go:reg:C170',
    ])
    expect(extractProvisionRefs('o registro 0000 e o C100', ['efd-icms-ipi'])).toEqual([
      'br:efd-icms-ipi:reg:0000',
      'br:efd-icms-ipi:reg:C100',
    ])
    expect(extractProvisionRefs('reg. e110', ['efd-icms-ipi'])).toEqual([
      'br:efd-icms-ipi:reg:E110',
    ])
    expect(extractProvisionRefs('Registro C170', ['rcte'])).toEqual([])
  })

  it('eventos da EFD-REINF, com ou sem hífen, só se a família foi pedida', () => {
    expect(extractProvisionRefs('R-2010 e R4020')).toEqual([
      'br:efd-reinf:evt:R-2010',
      'br:efd-reinf:evt:R-4020',
    ])
    expect(extractProvisionRefs('R-2010', ['efd-reinf'])).toEqual(['br:efd-reinf:evt:R-2010'])
    expect(extractProvisionRefs('R-2010', ['rcte'])).toEqual([])
  })

  it('não repete chaves e ignora valores fora da gramática', () => {
    expect(extractProvisionRefs('art. 76 e de novo o art. 76', ['rcte'])).toEqual([
      'go:rcte:art:76',
    ])
    expect(extractProvisionRefs('sem referência alguma')).toEqual([])
    // Com /iu, [a-z] casa o "ſ" (s longo), que não é alínea válida: só o artigo entra.
    expect(extractProvisionRefs('art. 5, alínea ſ', ['rcte'])).toEqual(['go:rcte:art:5'])
  })
})
