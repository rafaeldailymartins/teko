import type { ValidityInterval } from '@teko/shared/vigencia'
import { Family, Modality, ValidityBasis } from '#domain/corpus/family.ts'
import { ntValidity } from '#domain/corpus/leiaute-validity.ts'
import type {
  ParsedDocumentVersion,
  ParsedProvision,
  ParsedSource,
  ParsedVersion,
  SkippedVersion,
} from '#domain/corpus/parsed-source.ts'
import { buildStableKey, type StableKeySegment } from '#domain/corpus/provision-id.ts'
import { type DoclingBlock, readDoclingBlocks } from './docling/docling-document.ts'
import { buildVersion, resolveDescribedVersion } from './docling/source-version.ts'
import { ParseError, type Parser, type ParserInput } from './parser.ts'

/**
 * Parser por tópico (título numerado) a partir do `DoclingDocument`, para o Guia Prático da EFD de
 * Goiás e para as Notas Técnicas (EFD ICMS/IPI e EFD-REINF). Cada título `section_header`
 * numerado ("1.1 Informações…", "5. ABRANGÊNCIA…") abre um tópico, que vai até o próximo título
 * numerado de qualquer nível; o pai é o tópico ancestral mais próximo presente no documento.
 * Linhas do sumário (com pontilhado e página) e o que vem antes do primeiro título ficam de fora.
 *
 * - **Guia EFD-GO** (`efd-go`): chaves e títulos da fixture da F2 (`go:efd-go:item:1-1`,
 *   `Guia Prático da EFD de Goiás > 1.1 Informações…`, "Guia Prático da EFD de Goiás, item 1.1"),
 *   vigência `[publicação, próxima publicação)` (`publication_approx`) vinda do descritor.
 * - **NT** (`efd-icms-ipi`, `efd-reinf`): chave `br:<família>:nt:<ano-nnn>:item:<tópico>` (o
 *   número vem do último segmento de `source.id`, em `ano-n` ou `n-ano`: `nt/2025-001` e
 *   `nt/2025.001` → `2025-001`; `nt/05-2026` → `2026-005`), vigência de `ntValidity` (`optional` e `mandatory`, `legal_effect`, `retroactive`), com a
 *   próxima versão no fim de `versionValidDuring`. NT sem título numerado vira um dispositivo só.
 */

const GO_ROOT = 'Guia Prático da EFD de Goiás'
const HEADING_LABELS: ReadonlySet<string> = new Set(['section_header', 'title'])
const NUMBERED = /^(\d{1,3}(?:\.\d{1,3}){0,4})(?:\.\s*|\s+|(?=\p{Lu}))(\S.*)$/u
const TOC_ENTRY = /\.{4,}\s*\d+\s*$/
/**
 * Ruído de página que o Docling às vezes classifica como corpo: linhas só de traços ou
 * sublinhados, rodapés ("ECONOMIA/GO - 27 -", "- 26 -") e o título corrente do Guia EFD-GO
 * repetido em cada página.
 */
const PAGE_NOISE = [
  /^[\s_\-–—=.*]+$/,
  /^(?:ECONOMIA|SEFAZ)\/GO(?:\s*-\s*\d+\s*-)?$/,
  /^-\s*\d+\s*-$/,
  /^GUIA PRÁTICO DA ESCRITURAÇÃO FISCAL DIGITAL \(EFD ICMS\/IPI\) DE GOIÁS$/,
]

function isNoise(text: string): boolean {
  return PAGE_NOISE.some((pattern) => pattern.test(text))
}

interface Topic {
  readonly number: string
  readonly title: string
  readonly heading: string
  readonly body: string[]
}

function blockText(block: DoclingBlock): string {
  if (block.kind === 'text') {
    return block.text
  }
  return block.rows
    .map((row) => row.filter((cell) => cell !== '').join(' '))
    .filter((line) => line !== '')
    .join('\n')
}

function splitTopics(
  blocks: readonly DoclingBlock[],
  skipped: SkippedVersion[],
): { topics: Topic[]; preamble: string[] } {
  const topics: Topic[] = []
  const preamble: string[] = []
  const seen = new Set<string>()
  let current: Topic | null = null
  let discarding = false
  for (const block of blocks) {
    const heading =
      block.kind === 'text' && HEADING_LABELS.has(block.label) && !TOC_ENTRY.test(block.text)
        ? NUMBERED.exec(block.text)
        : null
    if (heading && block.kind === 'text') {
      const number = heading[1] ?? ''
      if (seen.has(number)) {
        skipped.push({ stableKey: null, reason: 'duplicate-topic', rawNote: block.text })
        current = null
        discarding = true
        continue
      }
      seen.add(number)
      current = { number, title: (heading[2] ?? '').trim(), heading: block.text, body: [] }
      discarding = false
      topics.push(current)
      continue
    }
    if (block.kind === 'table' && block.label === 'document_index') {
      continue
    }
    const text = blockText(block)
    if (text === '' || TOC_ENTRY.test(text) || isNoise(text)) {
      continue
    }
    if (current !== null) {
      current.body.push(text)
    } else if (!discarding) {
      preamble.push(text)
    }
  }
  return { topics, preamble }
}

function parentOf(number: string, present: ReadonlySet<string>): string | null {
  const parts = number.split('.')
  for (let length = parts.length - 1; length > 0; length -= 1) {
    const candidate = parts.slice(0, length).join('.')
    if (present.has(candidate)) {
      return candidate
    }
  }
  return null
}

function sortPathOf(number: string): string {
  return number
    .split('.')
    .map((part) => part.padStart(3, '0'))
    .join('.')
}

interface Mode {
  readonly family: Family
  readonly root: string
  readonly prefix: readonly StableKeySegment[]
  readonly version: ParsedDocumentVersion
  readonly replacementWindow: ValidityInterval
  readonly versionsFor: (displayLabel: string, text: string) => ParsedVersion[]
}

function goMode(input: ParserInput): Mode {
  const { version, validDuring } = resolveDescribedVersion(input)
  return {
    family: Family.EfdGo,
    root: GO_ROOT,
    prefix: [],
    version,
    replacementWindow: validDuring,
    versionsFor: (displayLabel, text) => [
      buildVersion({
        displayLabel,
        validDuring,
        modality: Modality.Mandatory,
        validityBasis: ValidityBasis.PublicationApprox,
        text,
      }),
    ],
  }
}

const NT_YEAR_FIRST = /^(\d{4})[.-](\d{1,3})$/
const NT_YEAR_LAST = /^(\d{1,3})[./-](\d{4})$/

/** Valor do segmento `nt` da chave (`ano-nnn`); `null` se o id não tiver o número da NT. */
export function ntSegmentValue(idSegment: string): string | null {
  const yearFirst = NT_YEAR_FIRST.exec(idSegment)
  if (yearFirst) {
    return `${yearFirst[1] ?? ''}-${(yearFirst[2] ?? '').padStart(3, '0')}`
  }
  const yearLast = NT_YEAR_LAST.exec(idSegment)
  if (yearLast) {
    return `${yearLast[2] ?? ''}-${(yearLast[1] ?? '').padStart(3, '0')}`
  }
  return null
}

function ntMode(input: ParserInput, family: Family): Mode {
  const { source } = input
  if (source.versionLabel === null || source.publishedOn === null) {
    throw new ParseError(`${source.id}: versionLabel e publishedOn são obrigatórios`)
  }
  const ntNumber = ntSegmentValue(source.id.split('/').at(-1) ?? '')
  if (ntNumber === null) {
    throw new ParseError(`${source.id}: número da NT ausente no id da fonte (ano-nnn ou nn-ano)`)
  }
  const publishedOn = source.publishedOn
  const nextFrom = source.versionValidDuring?.to ?? null
  const { versions, review } = ntValidity({
    publishedOn,
    effectiveFrom: source.effectiveFrom,
    optionalFrom: source.optionalFrom,
    mandatoryFrom: source.mandatoryFrom,
    nextFrom,
  })
  const fallback = source.versionValidDuring ?? { from: publishedOn, to: null }
  const first = versions[0]
  const last = versions.at(-1)
  const span: ValidityInterval =
    first === undefined || last === undefined
      ? fallback
      : { from: first.validDuring.from, to: last.validDuring.to }
  return {
    family,
    root: source.versionLabel,
    prefix: [{ kind: 'nt', value: ntNumber }],
    version: {
      versionLabel: source.versionLabel,
      publishedOn,
      validDuring: span,
      consolidatedUntil: null,
      actRef: source.actRef,
      sha256: input.sha256,
    },
    replacementWindow: span,
    versionsFor: (displayLabel, text) =>
      versions.length === 0
        ? [
            buildVersion({
              displayLabel,
              validDuring: fallback,
              modality: Modality.Mandatory,
              validityBasis: ValidityBasis.LegalEffect,
              text,
              review,
            }),
          ]
        : versions.map((entry) =>
            buildVersion({
              displayLabel,
              validDuring: entry.validDuring,
              modality: entry.modality,
              validityBasis: ValidityBasis.LegalEffect,
              retroactive: entry.retroactive,
              text,
              review,
            }),
          ),
  }
}

function modeFor(input: ParserInput): Mode {
  switch (input.source.family) {
    case Family.EfdGo:
      return goMode(input)
    case Family.EfdIcmsIpi:
    case Family.EfdReinf:
      return ntMode(input, input.source.family)
    default:
      throw new ParseError(
        `${input.source.id}: docling-generic lê o Guia EFD-GO e NTs, não ${input.source.family}`,
      )
  }
}

export const parseDoclingGeneric: Parser = (input) => {
  const mode = modeFor(input)
  const skipped: SkippedVersion[] = []
  const { topics, preamble } = splitTopics(readDoclingBlocks(input.docling), skipped)
  const present = new Set(topics.map((topic) => topic.number))
  const provisions: ParsedProvision[] = topics.map((topic) => {
    const parent = parentOf(topic.number, present)
    const key = (number: string) =>
      buildStableKey(mode.family, [
        ...mode.prefix,
        { kind: 'item', value: number.replaceAll('.', '-') },
      ])
    return {
      stableKey: key(topic.number),
      kind: 'topico',
      parent: parent === null ? undefined : key(parent),
      sortPath: sortPathOf(topic.number),
      headingPath: `${mode.root} > ${topic.number} ${topic.title}`,
      versions: mode.versionsFor(
        `${mode.root}, item ${topic.number}`,
        [topic.heading, ...topic.body].join('\n'),
      ),
    }
  })
  if (provisions.length === 0) {
    if (mode.family === Family.EfdGo || preamble.length === 0) {
      throw new ParseError(`${input.source.id}: nenhum tópico numerado no documento`)
    }
    provisions.push({
      stableKey: buildStableKey(mode.family, mode.prefix),
      kind: 'nota-tecnica',
      sortPath: '000',
      headingPath: mode.root,
      versions: mode.versionsFor(mode.root, preamble.join('\n')),
    })
  }
  const source: ParsedSource = {
    document: input.source.document,
    version: mode.version,
    replacementWindow: mode.replacementWindow,
    provisions,
    skipped,
    stats: { notesTotal: 0, notesParsed: 0, notesToReview: 0 },
  }
  return source
}
