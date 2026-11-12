import { describe, expect, it } from 'vitest'
import { buildZip } from './testing/zip-builder.ts'
import { readZip, ZipError } from './zip.ts'

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes)

describe('readZip', () => {
  it('lê membros comprimidos e armazenados, ignora diretórios e abre zip interno', () => {
    const inner = buildZip([{ name: 'R-1000-evtInfoContri-v2_01_02.xsd', data: '<xs:schema/>' }])
    const zip = buildZip([
      { name: 'pacote/', data: '', method: 0 },
      { name: 'pacote/leia-me.txt', data: 'olá, mundo', method: 0 },
      { name: 'pacote/R-2010.xsd', data: '<xs:schema>'.repeat(50) },
      { name: 'pacote/interno.zip', data: inner, method: 0 },
    ])
    const members = readZip(zip)
    expect([...members.keys()]).toEqual([
      'pacote/leia-me.txt',
      'pacote/R-2010.xsd',
      'pacote/interno.zip/R-1000-evtInfoContri-v2_01_02.xsd',
    ])
    expect(text(members.get('pacote/leia-me.txt'))).toBe('olá, mundo')
    expect(text(members.get('pacote/R-2010.xsd'))).toBe('<xs:schema>'.repeat(50))
    expect(text(members.get('pacote/interno.zip/R-1000-evtInfoContri-v2_01_02.xsd'))).toBe(
      '<xs:schema/>',
    )
  })

  it('lê nomes sem a flag UTF-8 como cp850', () => {
    // "versão" em cp850: ã = 0xC6.
    const rawName = new Uint8Array([
      ...new TextEncoder().encode('vers'),
      0xc6,
      0x6f,
      0x2e,
      0x70,
      0x64,
      0x66,
    ])
    const members = readZip(buildZip([{ name: '', rawName, data: 'pdf' }]))
    expect([...members.keys()]).toEqual(['versão.pdf'])
  })

  it.each([
    [
      'não é zip',
      new TextEncoder().encode('isto não é um zip, só texto comprido o bastante'),
      /não é um zip/,
    ],
    ['pequeno demais', new Uint8Array(4), /pequeno demais/],
    ['caminho com ..', buildZip([{ name: '../fora.txt', data: 'x' }]), /caminho inseguro/],
    ['caminho absoluto', buildZip([{ name: '/etc/passwd', data: 'x' }]), /caminho inseguro/],
    ['letra de unidade', buildZip([{ name: 'C:\\x.txt', data: 'x' }]), /caminho inseguro/],
    ['criptografado', buildZip([{ name: 'a.txt', data: 'x', flags: 0x0801 }]), /criptografado/],
    [
      'tamanho declarado falso',
      buildZip([{ name: 'a.txt', data: 'abc', declaredSize: 2 }]),
      /diferente do declarado/,
    ],
    [
      'membro gigante',
      buildZip([{ name: 'a.txt', data: 'abc', declaredSize: 0x7fffffff }]),
      /grande demais/,
    ],
  ])('recusa %s', (_name, bytes, message) => {
    expect(() => readZip(bytes)).toThrow(ZipError)
    expect(() => readZip(bytes)).toThrow(message)
  })

  it('recusa método de compressão desconhecido e diretório central corrompido', () => {
    const zip = buildZip([{ name: 'a.txt', data: 'abc', method: 0 }])
    const bad = new Uint8Array(zip)
    // Método do diretório central (deslocamento 10 a partir do início do registro central).
    const view = new DataView(bad.buffer)
    const central = bad.byteLength - 22 - (46 + 'a.txt'.length)
    view.setUint16(central + 10, 12, true)
    expect(() => readZip(bad)).toThrow(/método de compressão 12/)
    view.setUint32(central, 0, true)
    expect(() => readZip(bad)).toThrow(/diretório central corrompido/)
  })

  it('recusa cabeçalho local inválido e membro truncado', () => {
    const zip = buildZip([{ name: 'a.txt', data: 'abcdef', method: 0 }])
    const local = new Uint8Array(zip)
    new DataView(local.buffer).setUint32(0, 0, true)
    expect(() => readZip(local)).toThrow(/cabeçalho local inválido/)
    const truncated = new Uint8Array(zip)
    const central = truncated.byteLength - 22 - (46 + 'a.txt'.length)
    // Tamanho comprimido maior que o arquivo.
    new DataView(truncated.buffer).setUint32(central + 20, 10_000, true)
    expect(() => readZip(truncated)).toThrow(/truncado/)
  })
})
