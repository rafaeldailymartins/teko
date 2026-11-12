import type { ExternalTableVersion } from './parsers/parser.ts'

/**
 * Leitura do `consultarVersoesTabelasExternas` do WS de Tabelas Externas do SPED. A resposta é um
 * XML cujo `metadadosXml` traz outro XML, escapado, com uma `<tabela id versao desc dtVersao hash>`
 * por tabela. Basta desescapar e ler os atributos: não há estrutura aninhada a percorrer.
 */

export class WsTabelasError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WsTabelasError'
  }
}

const ENTITIES: Readonly<Record<string, string>> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&amp;': '&',
}

function unescapeXml(text: string): string {
  return text.replace(/&(?:lt|gt|quot|apos|amp);/g, (entity) => ENTITIES[entity] ?? entity)
}

function attributes(tag: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const match of tag.matchAll(/(?:^|\s)([A-Za-z]+)="([^"]*)"/g)) {
    result.set(match[1] ?? '', unescapeXml(match[2] ?? ''))
  }
  return result
}

/** Versões atuais das tabelas, por `id`. Lança `WsTabelasError` se a resposta não for a esperada. */
export function parseTableVersions(xml: string): ReadonlyMap<number, ExternalTableVersion> {
  const code = /<codigoRetorno>(\d+)<\/codigoRetorno>/.exec(xml)?.[1]
  if (code === undefined) {
    throw new WsTabelasError('resposta do consultarVersoesTabelasExternas sem codigoRetorno')
  }
  const metadata = unescapeXml(/<metadadosXml>([\s\S]*?)<\/metadadosXml>/.exec(xml)?.[1] ?? '')
  const tables = new Map<number, ExternalTableVersion>()
  for (const match of metadata.matchAll(/<tabela\s([^>]*?)\/?>/g)) {
    const attrs = attributes(match[1] ?? '')
    const id = Number(attrs.get('id'))
    const versao = Number(attrs.get('versao'))
    const desc = attrs.get('desc')
    const dtVersao = attrs.get('dtVersao')
    const hash = attrs.get('hash')
    if (
      !Number.isInteger(id) ||
      !Number.isInteger(versao) ||
      desc === undefined ||
      dtVersao === undefined ||
      hash === undefined
    ) {
      continue
    }
    tables.set(id, { id, versao, desc, dtVersao, hash })
  }
  if (tables.size === 0) {
    throw new WsTabelasError(`consultarVersoesTabelasExternas sem tabelas (codigoRetorno ${code})`)
  }
  return tables
}

/** URL de download de uma versão: `obterTabela.ashx?idTabela=<id>&versao=<versao>`. */
export function tableDownloadUrl(base: string, table: ExternalTableVersion): string {
  const url = new URL(base)
  url.searchParams.set('idTabela', String(table.id))
  url.searchParams.set('versao', String(table.versao))
  return url.toString()
}
