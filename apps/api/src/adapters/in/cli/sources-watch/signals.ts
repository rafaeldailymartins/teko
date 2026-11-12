import { type IsoDate, isIsoDate } from '@teko/shared/vigencia'
import { Parser } from 'htmlparser2'
import {
  type ActListPage,
  type DocumentIndexPage,
  type FetchedPage,
  type PageSignals,
  type TablesWsPage,
  type WatchedItem,
  WatchKind,
  type WatchPage,
  WatchSignalError,
  type WatchSignalReader,
} from '#app/ports/watch-signals.ts'
import { compareCodeUnits } from '#domain/shared/compare-code-units.ts'

/**
 * Leitura dos sinais de versão das páginas monitoradas (`htmlparser2` 12 em modo HTML para as
 * páginas e em `xmlMode` para o WS de Tabelas Externas). Ver `#app/ports/watch-signals.ts`.
 *
 * Datas `dd.mm.aa` usam pivô 70 (`26` → 2026, `97` → 1997): as fontes monitoradas são de 1991 em
 * diante. Os números de ato perdem o separador de milhar (`10.986` → 10986).
 */

interface Link {
  readonly href: string
  readonly text: string
}

interface HtmlContent {
  /** Texto visível, com espaços colapsados (sem `<script>`/`<style>`). */
  readonly text: string
  readonly links: readonly Link[]
}

const SKIPPED_TAGS = new Set(['script', 'style'])
const BLOCK_TAGS = new Set(['p', 'br', 'div', 'td', 'tr', 'li', 'h1', 'h2', 'h3', 'h4', 'table'])

function collapse(text: string): string {
  return text.replaceAll(' ', ' ').replaceAll(/\s+/g, ' ').trim()
}

function decode(page: WatchPage, body: Uint8Array): string {
  return new TextDecoder(page.encoding).decode(body)
}

/** Texto e links de um HTML, em uma passada. */
export function readHtml(html: string): HtmlContent {
  const parts: string[] = []
  const links: Link[] = []
  let skipping = 0
  let link: { href: string; text: string[] } | null = null
  const parser = new Parser({
    onopentag(name, attribs) {
      if (SKIPPED_TAGS.has(name)) {
        skipping += 1
      } else if (BLOCK_TAGS.has(name)) {
        parts.push(' ')
      }
      const { href } = attribs
      if (name === 'a' && href !== undefined) {
        link = { href, text: [] }
      }
    },
    ontext(data) {
      if (skipping > 0) {
        return
      }
      parts.push(data)
      link?.text.push(data)
    },
    onclosetag(name) {
      if (SKIPPED_TAGS.has(name)) {
        skipping = Math.max(0, skipping - 1)
      } else if (BLOCK_TAGS.has(name)) {
        parts.push(' ')
      }
      if (name === 'a' && link !== null) {
        links.push({ href: link.href, text: collapse(link.text.join('')) })
        link = null
      }
    },
  })
  parser.end(html)
  return { text: collapse(parts.join('')), links }
}

/** `dd.mm.aa` ou `dd.mm.aaaa` → ISO; `null` se a data não existir. */
export function parseDottedDate(day: string, month: string, year: string): IsoDate | null {
  let fullYear = Number(year)
  if (year.length === 2) {
    fullYear += fullYear >= 70 ? 1900 : 2000
  }
  const iso = `${String(fullYear).padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  return isIsoDate(iso) ? iso : null
}

function actNumber(text: string): number {
  return Number(text.replaceAll('.', ''))
}

function actLabel(kind: string, number: string): string {
  const normalized = kind.toLowerCase() === 'lei' ? 'Lei' : 'Decreto'
  return `${normalized} nº ${number}`
}

const DATE = String.raw`(\d{1,2})\.(\d{1,2})\.(\d{2,4})`
const ACT_NUMBER = String.raw`n\s*[º°o.]*\s*(\d{1,3}(?:\.\d{3})*|\d+)`

const CONSOLIDATED_RE = new RegExp(
  String.raw`(?:CONSOLIDAD[OA]|ATUALIZAD[OA])\s+AT[ÉE]\s+(?:O|A)\s+(DECRETO|LEI)\s+${ACT_NUMBER}\s*,?\s*DE\s+${DATE}`,
  'iu',
)

function readConsolidated(page: WatchPage, fetched: FetchedPage): PageSignals {
  const { text } = readHtml(decode(page, fetched.body))
  const match = CONSOLIDATED_RE.exec(text)
  if (match === null) {
    throw new WatchSignalError(
      `cabeçalho "CONSOLIDADO ATÉ O DECRETO Nº …" não encontrado em ${fetched.url}`,
    )
  }
  const [, kind = '', number = '', day = '', month = '', year = ''] = match
  return {
    label: actLabel(kind, number),
    labelDate: parseDottedDate(day, month, year),
    labelNumber: actNumber(number),
    items: [],
  }
}

function absoluteUrl(href: string, base: string): string | null {
  let url: URL
  try {
    url = new URL(href, base)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null
  }
  url.hash = ''
  return url.href.endsWith('/') ? url.href.slice(0, -1) : url.href
}

function compile(pattern: string | null): RegExp | null {
  return pattern === null ? null : new RegExp(pattern, 'iu')
}

/** Mapa número do ato → URL, pelos links cujo texto traz o número. */
function actLinks(links: readonly Link[], base: string): Map<number, string> {
  const byNumber = new Map<number, string>()
  const numberRe = /(\d{1,3}(?:\.\d{3})+|\d{4,})/u
  for (const link of links) {
    const found = numberRe.exec(link.text)
    const url = absoluteUrl(link.href, base)
    if (found?.[1] === undefined || url === null) {
      continue
    }
    const number = actNumber(found[1])
    if (!byNumber.has(number)) {
      byNumber.set(number, url)
    }
  }
  return byNumber
}

function readActList(page: ActListPage, fetched: FetchedPage): PageSignals {
  const { text, links } = readHtml(decode(page, fetched.body))
  const kind = page.act === 'lei' ? 'Lei' : 'Decreto'
  const actRe = new RegExp(
    String.raw`${kind}\s+${ACT_NUMBER}\s*,?\s*,?\s*de\s+${DATE}(?:\s*\(\s*DOE\s+de\s+${DATE}[^)]*\))?`,
    'giu',
  )
  const matches = [...text.matchAll(actRe)]
  const include = compile(page.include)
  const exclude = compile(page.exclude)
  const urls = actLinks(links, fetched.url)
  const items: WatchedItem[] = []
  const seen = new Set<number>()
  matches.forEach((match, index) => {
    const [, number = '', day = '', month = '', year = '', doeDay, doeMonth, doeYear] = match
    const start = (match.index ?? 0) + match[0].length
    const end = matches[index + 1]?.index ?? text.length
    const summary = text.slice(start, Math.min(end, start + 600)).trim()
    const value = actNumber(number)
    if (seen.has(value) || include?.test(summary) === false || exclude?.test(summary) === true) {
      return
    }
    seen.add(value)
    const actDate = parseDottedDate(day, month, year)
    const doeDate =
      doeDay !== undefined && doeMonth !== undefined && doeYear !== undefined
        ? parseDottedDate(doeDay, doeMonth, doeYear)
        : null
    const date = doeDate ?? actDate
    items.push({
      key: String(value),
      url: urls.get(value) ?? `${fetched.url}#ato-${String(value)}`,
      versionLabel: actLabel(kind, number),
      date,
      fingerprint: date ?? '',
      actNumber: value,
    })
  })
  return { label: null, labelDate: null, labelNumber: null, items }
}

function fileName(url: string): string {
  const path = new URL(url).pathname
  const last = path.slice(path.lastIndexOf('/') + 1)
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

function versionFrom(url: string, pattern: RegExp | null): string | null {
  if (pattern === null) {
    return null
  }
  const match = pattern.exec(fileName(url))
  if (match === null) {
    return null
  }
  const groups = match.slice(1).filter((group): group is string => group !== undefined)
  return groups.length === 0 ? match[0] : groups.join('.')
}

/**
 * Links do índice: `href` do HTML e URLs absolutas no corpo inteiro (o portal gov.br monta a
 * página no cliente, e os links só aparecem no JSON embutido, com `/` escapado como `/`).
 */
function readDocumentIndex(page: DocumentIndexPage, fetched: FetchedPage): PageSignals {
  const raw = decode(page, fetched.body)
  const unescaped = raw.replaceAll(/\\u002f/giu, '/').replaceAll('\\/', '/')
  const candidates = new Set<string>()
  for (const link of readHtml(raw).links) {
    const url = absoluteUrl(link.href, fetched.url)
    if (url !== null) {
      candidates.add(url)
    }
  }
  for (const match of unescaped.matchAll(/https?:\/\/[^\s"'<>\\]+/giu)) {
    const url = absoluteUrl(match[0].replaceAll('&amp;', '&'), fetched.url)
    if (url !== null) {
      candidates.add(url)
    }
  }
  const patterns = page.documents.map((document) => ({
    pattern: new RegExp(document.pattern, 'iu'),
    version: compile(document.versionPattern),
  }))
  const items: WatchedItem[] = []
  for (const url of [...candidates].sort(compareCodeUnits)) {
    const matched = patterns.find((entry) => entry.pattern.test(url))
    if (matched === undefined) {
      continue
    }
    items.push({
      key: url,
      url,
      versionLabel: versionFrom(url, matched.version),
      date: null,
      fingerprint: '1',
      actNumber: null,
    })
  }
  return { label: null, labelDate: null, labelNumber: null, items }
}

interface TableMeta {
  readonly versao: string
  readonly dtVersao: string
  readonly hash: string
}

function xmlText(xml: string, tag: string): string | null {
  let depth = 0
  const parts: string[] = []
  let found = false
  const parser = new Parser(
    {
      onopentag(name) {
        if (name === tag) {
          depth += 1
          found = true
        }
      },
      ontext(data) {
        if (depth > 0) {
          parts.push(data)
        }
      },
      onclosetag(name) {
        if (name === tag) {
          depth -= 1
        }
      },
    },
    { xmlMode: true },
  )
  parser.end(xml)
  return found ? parts.join('') : null
}

function readTablesWs(page: TablesWsPage, fetched: FetchedPage): PageSignals {
  const xml = decode(page, fetched.body)
  const metadata = xmlText(xml, 'metadadosXml')
  if (metadata === null) {
    throw new WatchSignalError(`resposta do WS sem metadadosXml em ${fetched.url}`)
  }
  const download = xmlText(xml, 'urlDownloadArquivo')?.trim() || fetched.url
  const tables = new Map<number, TableMeta>()
  const parser = new Parser(
    {
      onopentag(name, attribs) {
        const { id, versao = '', dtVersao = '', hash = '' } = attribs
        const tableId = Number(id)
        if (name !== 'tabela' || !Number.isInteger(tableId)) {
          return
        }
        tables.set(tableId, { versao, dtVersao, hash })
      },
    },
    { xmlMode: true },
  )
  parser.end(metadata.replace(/^﻿/u, ''))
  const items = page.tableIds.map((id): WatchedItem => {
    const table = tables.get(id)
    if (table === undefined || table.versao === '') {
      throw new WatchSignalError(`tabela ${String(id)} ausente do metadadosXml em ${fetched.url}`)
    }
    const url = new URL(download)
    url.searchParams.set('idTabela', String(id))
    url.searchParams.set('versao', table.versao)
    return {
      key: String(id),
      url: url.href,
      versionLabel: `versão ${table.versao}`,
      date: isIsoDate(table.dtVersao) ? table.dtVersao : null,
      fingerprint: `${table.versao}:${table.hash.toUpperCase()}`,
      actNumber: null,
    }
  })
  return { label: null, labelDate: null, labelNumber: null, items }
}

export function createWatchSignalReader(): WatchSignalReader {
  return {
    read(page, fetched) {
      switch (page.kind) {
        case WatchKind.Consolidated:
          return readConsolidated(page, fetched)
        case WatchKind.ActList:
          return readActList(page, fetched)
        case WatchKind.DocumentIndex:
          return readDocumentIndex(page, fetched)
        case WatchKind.TablesWs:
          return readTablesWs(page, fetched)
      }
    },
  }
}
