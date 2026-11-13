import type { IsoDate, ValidityInterval } from '@teko/shared/vigencia'
import { Parser as HtmlParser } from 'htmlparser2'
import { ChangeKind, Family, Modality, ReviewStatus, ValidityBasis } from '#domain/corpus/family.ts'
import type {
  ParsedAmendment,
  ParsedLabel,
  ParsedProvision,
  ParsedSource,
  ParsedVersion,
  SkippedVersion,
} from '#domain/corpus/parsed-source.ts'
import {
  buildStableKey,
  InvalidStableKeyError,
  type StableKeySegment,
} from '#domain/corpus/provision-id.ts'
import {
  type AmendmentNote,
  applyRestructuringCut,
  extractInlineNote,
  flagOverlaps,
  type InlineNote,
  isRetroactive,
  mergeIdenticalConsecutive,
  parseAmendmentNote,
  parseNoteDate,
  parseValidityNote,
  parseWithoutEffectNote,
  type ReviewMark,
  ReviewReason,
  resolveTimeline,
  SkipReason,
  type TimedText,
  type ValidityNote,
  type VersionCandidate,
} from '#domain/corpus/validity.ts'
import { compareCodeUnits } from '#domain/shared/compare-code-units.ts'
import { ParseError, type Parser, type ParserInput } from './parser.ts'

/**
 * Parser dos consolidados de Goiás (RCTE e CTE): HTML do Word em cp1252, lido parágrafo a
 * parágrafo por uma máquina de estados. A classe de cada `<p>` diz o papel dele:
 *
 * - `ParNormal` (e `PargrafoAlterador`, `Normal`, `MsoNormal`): redação vigente;
 * - `TextoRevo`: redação superada;
 * - `NovaRedao`/`NovaRedRev`: nota de alteração (ato e data de efeito) que abre a redação seguinte;
 * - `NotaVigncia`/`NotaVigor`: nota de vigência que fecha as redações superadas logo antes dela;
 * - `TitCentral` e `PargrafoAlterador-titulo`: títulos (Livro, Título, Capítulo, Seção, Subseção,
 *   inclusive os acrescidos depois, como "CAPÍTULO IV-A");
 * - `NotaDisc*`, `NotaRev*` e demais: notas editoriais, transparentes, exceto a nota "Redação …
 *   sem efeitos a partir de …", que termina a redação citada (em qualquer classe de nota ou texto).
 *
 * A ordem dos parágrafos vale mais que o texto das notas: uma nota de vigência fecha o grupo de
 * redações superadas que a antecede, e uma nota de alteração abre o primeiro dispositivo que vem
 * depois dela (e os filhos dele, salvo "nova redação ao caput"). As datas e a linha do tempo de
 * cada dispositivo ficam nas regras puras de `domain/corpus/validity.ts`.
 */

// ---------------------------------------------------------------------------------------------
// Leitura dos parágrafos (streaming)

export interface Paragraph {
  /** Primeira classe do `<p>` (`ParNormal`, `TextoRevo`…); `''` sem classe. */
  readonly className: string
  /** Texto com entidades decodificadas e espaços colapsados. */
  readonly text: string
  /** Âncoras `<a name>` dentro do parágrafo (ex.: `A76P6`). */
  readonly anchors: readonly string[]
}

const SKIPPED_ELEMENTS: ReadonlySet<string> = new Set(['style', 'script', 'head', 'title'])
const DECODE_CHUNK = 1 << 16

/**
 * Decodifica os bytes como Windows-1252 (explícito: a fonte não declara o charset de forma
 * confiável) e lê os `<p>` em streaming com o `htmlparser2`.
 */
export function readParagraphs(bytes: Uint8Array): Paragraph[] {
  const paragraphs: Paragraph[] = []
  let skipDepth = 0
  let current: { className: string; text: string; anchors: string[] } | null = null
  const parser = new HtmlParser({
    onopentag(name, attributes) {
      const { class: classAttribute = '', name: anchor } = attributes
      if (SKIPPED_ELEMENTS.has(name)) {
        skipDepth += 1
      } else if (name === 'p') {
        current = { className: classAttribute.split(/\s+/)[0] ?? '', text: '', anchors: [] }
      } else if (current !== null && name === 'a' && anchor !== undefined) {
        current.anchors.push(anchor)
      } else if (current !== null && name === 'br') {
        current.text += ' '
      }
    },
    ontext(text) {
      if (skipDepth === 0 && current !== null) {
        current.text += text
      }
    },
    onclosetag(name) {
      if (SKIPPED_ELEMENTS.has(name)) {
        skipDepth = Math.max(0, skipDepth - 1)
      } else if (name === 'p' && current !== null) {
        const text = current.text.replace(/\s+/g, ' ').trim()
        if (text !== '') {
          paragraphs.push({ className: current.className, text, anchors: current.anchors })
        }
        current = null
      }
    },
  })
  const decoder = new TextDecoder('windows-1252')
  for (let offset = 0; offset < bytes.length; offset += DECODE_CHUNK) {
    parser.write(decoder.decode(bytes.subarray(offset, offset + DECODE_CHUNK), { stream: true }))
  }
  parser.write(decoder.decode())
  parser.end()
  return paragraphs
}

// ---------------------------------------------------------------------------------------------
// Perfis dos documentos

interface ConsolidatedProfile {
  readonly family: typeof Family.Rcte | typeof Family.Cte
  /** Prefixo do `headingPath` e do rótulo exibido. */
  readonly prefix: string
  readonly yearPivot: number
  /** Início da redação original (vigência da norma). */
  readonly originalFrom: IsoDate
  /** Reestruturação que trocou o conteúdo de números de artigo (CTE: Lei 12.972/96). */
  readonly restructuredOn: IsoDate | null
  /** Recorte por títulos (CTE: Livro I, Título II). */
  readonly slice: { readonly start: RegExp; readonly end: RegExp } | null
  readonly actRef: string
  /** "RCTE consolidado até o" / "CTE atualizado até a". */
  readonly versionLabelLead: string
}

const PROFILES: Readonly<Record<'rcte' | 'cte', ConsolidatedProfile>> = {
  rcte: {
    family: Family.Rcte,
    prefix: 'RCTE',
    yearPivot: 97,
    originalFrom: '1998-01-01',
    restructuredOn: null,
    slice: null,
    actRef: 'Decreto nº 4.852, de 29.12.97',
    versionLabelLead: 'RCTE consolidado até o',
  },
  cte: {
    family: Family.Cte,
    prefix: 'CTE',
    yearPivot: 91,
    originalFrom: '1992-03-01',
    restructuredOn: '1997-01-01',
    slice: { start: /^T[IÍ]TULO II$/i, end: /^T[IÍ]TULO III$/i },
    actRef: 'Lei nº 11.651, de 26.12.91',
    versionLabelLead: 'CTE atualizado até a',
  },
}

// ---------------------------------------------------------------------------------------------
// Rótulos de dispositivo e chaves

type SegmentKind = 'art' | 'par' | 'inc' | 'ali' | 'item'

interface Segment {
  readonly kind: SegmentKind
  readonly value: string
}

const ROMAN = /^M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/

function romanToInt(roman: string): number {
  const values: Readonly<Record<string, number>> = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
    D: 500,
    M: 1000,
  }
  let total = 0
  for (let index = 0; index < roman.length; index += 1) {
    const value = values[roman[index] ?? ''] ?? 0
    const next = values[roman[index + 1] ?? ''] ?? 0
    total += value < next ? -value : value
  }
  return total
}

/** Sufixo de letra em item ou alínea ("2-A", "b-1"): a gramática da chave só aceita números. */
function letterToNumber(letter: string): string {
  return String(letter.toUpperCase().charCodeAt(0) - 64)
}

const LABEL_PATTERNS: readonly (readonly [RegExp, (match: RegExpExecArray) => Segment | null])[] = [
  [
    // "Art. 76.", "Art. 56-A.", "Art. 6ºA", "Art. 167-G-A."; "Art. 10 A alíquota" não tem sufixo.
    /^Art\.?\s*(\d{1,4})(?:\s?[º°]|o(?![a-z]))?((?:\s*-\s*[A-Z](?![A-Za-z]))+|[A-Z](?![A-Za-z]))?/,
    (m) => ({
      kind: 'art',
      value: [m[1], ...(m[2] ?? '').split(/[\s-]+/).filter((part) => part !== '')].join('-'),
    }),
  ],
  [/^Par[áa]grafo\s+[úu]nico\b|^§\s*[úu]nico\b/i, () => ({ kind: 'par', value: 'unico' })],
  [
    /^§\s*(\d{1,2})(?:\s?[º°]|o(?![a-z]))?(?:\s*-\s*([A-Za-z])(?![a-z])|([A-Z])(?![A-Za-z]))?/,
    (m) => ({ kind: 'par', value: suffixed(m[1], m[2] ?? m[3]) }),
  ],
  [
    /^([IVXLC]{1,8})(?:\s*-\s*([A-Z]))?\s*[-–—]\s*/,
    (m) => (ROMAN.test(m[1] ?? '') ? { kind: 'inc', value: suffixed(m[1], m[2]) } : null),
  ],
  [
    /^([a-z])(?:\s*-\s*(\d{1,2}|[a-z]))?\s*\)/,
    (m) => ({
      kind: 'ali',
      value:
        m[2] === undefined
          ? (m[1] ?? '')
          : `${m[1]}-${/\d/.test(m[2]) ? m[2] : letterToNumber(m[2])}`,
    }),
  ],
  [
    // "1.", "2-A."; "2.1." (subitem, sem espaço depois do primeiro ponto) fica no texto do item,
    // como na fixture.
    /^(\d{1,3})(?:-([A-Z]|\d{1,3}))?\s*[.)\-–]\s+/,
    (m) => ({ kind: 'item', value: itemValue(m[1] ?? '', m[2]) }),
  ],
]

function suffixed(number: string | undefined, letter: string | undefined): string {
  return letter === undefined ? (number ?? '') : `${number}-${letter.toUpperCase()}`
}

function itemValue(head: string, suffix: string | undefined): string {
  const number = String(Number(head))
  if (suffix === undefined) {
    return number
  }
  return `${number}-${/\d/.test(suffix) ? String(Number(suffix)) : letterToNumber(suffix)}`
}

/** Rótulo do dispositivo no início do parágrafo (`Art. 76.`, `§ 6º`, `II -`, `a)`, `1.`). */
export function parseLabel(text: string): Segment | null {
  for (const [pattern, build] of LABEL_PATTERNS) {
    const match = pattern.exec(text)
    if (match !== null) {
      return build(match)
    }
  }
  return null
}

const ORDER: readonly SegmentKind[] = ['art', 'par', 'inc', 'ali', 'item']

const KIND_NAMES: Readonly<Record<SegmentKind, string>> = {
  art: 'artigo',
  par: 'paragrafo',
  inc: 'inciso',
  ali: 'alinea',
  item: 'item',
}

/** "167-S-B" → ["167", "S-B"]; "76" → ["76", undefined]. */
function splitSuffix(value: string): readonly [string, string | undefined] {
  const [head = '', ...suffixes] = value.split('-')
  return [head, suffixes.length === 0 ? undefined : suffixes.join('-')]
}

function ordinal(number: string): string {
  return Number(number) < 10 ? `${number}º` : number
}

function segmentTail(segment: Segment, forHeading: boolean): string {
  const [head, suffix] = splitSuffix(segment.value)
  const withSuffix = (base: string): string => (suffix === undefined ? base : `${base}-${suffix}`)
  switch (segment.kind) {
    case 'art':
      return withSuffix(`${forHeading ? 'Art.' : 'art.'} ${ordinal(head)}`)
    case 'par':
      return segment.value === 'unico' ? 'parágrafo único' : withSuffix(`§ ${head}º`)
    case 'inc':
      return `inciso ${segment.value}`
    case 'ali':
      return `alínea "${segment.value}"`
    default:
      return `item ${segment.value}`
  }
}

/** "RCTE, art. 76, § 6º, inciso I" (vira o `citation_label` do chunk). */
export function displayLabelOf(prefix: string, segments: readonly Segment[]): string {
  return [prefix, ...segments.map((segment) => segmentTail(segment, false))].join(', ')
}

/** Final do `headingPath`: "Art. 76 > § 6º > inciso I > alínea \"a\"". */
export function headingTailOf(segments: readonly Segment[]): string {
  return segments.map((segment) => segmentTail(segment, true)).join(' > ')
}

function sortPart(segment: Segment): string {
  const [head, suffix] = splitSuffix(segment.value)
  switch (segment.kind) {
    case 'art':
      return `${head.padStart(4, '0')}${suffix?.replaceAll('-', '') ?? ''}`
    case 'par':
      return segment.value === 'unico' ? 'p00' : `p${head.padStart(2, '0')}${suffix ?? ''}`
    case 'inc':
      return `i${String(romanToInt(head)).padStart(2, '0')}${suffix ?? ''}`
    case 'ali':
      return `a${head}${suffix ?? ''}`
    default:
      return `n${segment.value
        .split('-')
        .map((part, index) => (index === 0 ? part.padStart(3, '0') : part))
        .join('-')}`
  }
}

/** Ordem no documento ("0076.p06.i02"), no formato da fixture da F2. */
export function sortPathOf(segments: readonly Segment[]): string {
  return segments.map(sortPart).join('.')
}

function keyOf(family: ConsolidatedProfile['family'], segments: readonly Segment[]): string {
  return buildStableKey(
    family,
    segments.map((segment): StableKeySegment => ({ kind: segment.kind, value: segment.value })),
  )
}

/**
 * Abertura dada por uma nota própria. A renumeração ("O § 1º vigorou como parágrafo único até…")
 * antes de uma redação superada conta a história do rótulo, não o início daquele texto.
 */
function openingOf(note: AmendmentNote, superseded: boolean): IsoDate | null {
  return superseded && note.changeKind === ChangeKind.Renumeracao ? null : note.effectiveFrom
}

/**
 * Só a data de início da nota está ilegível ("230.09.03 a 20.08.07") e a nota de alteração do
 * próprio dispositivo dá a abertura: vale a abertura do ato (como na fixture da F2), sem revisão.
 */
function resolvedByOwnAct(
  draft: Draft,
  note: Extract<ValidityNote, { kind: 'unparsed' }>,
): boolean {
  return (
    note.reason === ReviewReason.NoteDateIllegible &&
    note.first === null &&
    note.last !== null &&
    draft.amendmentOwn &&
    draft.amendmentFrom !== null
  )
}

function applyNote(draft: Draft, note: Exclude<ValidityNote, { kind: 'not-validity' }>): void {
  draft.closedByNote = true
  if (note.kind === 'without-validity') {
    draft.noteWithoutValidity = true
    return
  }
  draft.noteFirst = note.first
  draft.noteLast = note.kind === 'start' ? null : note.last
}

/** Prefixo das chaves provisórias de rótulos fora da gramática da `stable_key`. */
const INVALID_KEY_PREFIX = '#invalida:'
const INVALID_KEY_REASON = 'chave-invalida'

/**
 * Chave do rascunho. Um rótulo fora da gramática (ex.: "Art. 167-S-B") ganha uma chave
 * provisória: as notas dele seguem a máquina de estados normalmente (e contam), mas as redações
 * vão para `skipped` em vez de virar dispositivo.
 */
function draftKeyOf(family: ConsolidatedProfile['family'], segments: readonly Segment[]): string {
  try {
    return keyOf(family, segments)
  } catch (error) {
    if (error instanceof InvalidStableKeyError) {
      return `${INVALID_KEY_PREFIX}${segments.map((segment) => `${segment.kind}:${segment.value}`).join(':')}`
    }
    throw error
  }
}

/** Redação ainda sem fim declarado (nota de vigência, nota inline, ato ou nota "sem efeitos"). */
function isOpenEnded(draft: Draft): boolean {
  return (
    !draft.closedByNote &&
    draft.inline?.last == null &&
    !(draft.amendmentOwn && draft.amendment?.until != null) &&
    draft.withoutEffect === null
  )
}

function isAncestorOrSelf(ancestor: readonly Segment[], segments: readonly Segment[]): boolean {
  return (
    ancestor.length <= segments.length &&
    ancestor.every(
      (segment, index) =>
        segment.kind === segments[index]?.kind && segment.value === segments[index]?.value,
    )
  )
}

// ---------------------------------------------------------------------------------------------
// Títulos

const HEADING_LEVELS: readonly (readonly [RegExp, number])[] = [
  [/^LIVRO\b/i, 0],
  [/^T[ÍI]TULO\b/i, 1],
  [/^CAP[ÍI]TULO\b/i, 2],
  [/^SUBSE[ÇC][ÃA]O\b/i, 4],
  [/^SE[ÇC][ÃA]O\b/i, 3],
]

function headingLevel(text: string): number | null {
  return HEADING_LEVELS.find(([pattern]) => pattern.test(text))?.[1] ?? null
}

// ---------------------------------------------------------------------------------------------
// Máquina de estados

type Role = 'heading' | 'amendment' | 'validity-note' | 'without-effect' | 'text' | 'editorial'

const TEXT_CLASSES: ReadonlySet<string> = new Set([
  'ParNormal',
  'PargrafoAlterador',
  'Normal',
  'MsoNormal',
  'TextoRevo',
  '',
])

/** Título acrescido por ato posterior ("CAPÍTULO IV-A", "Subseção V-A") e o nome dele. */
const ADDED_HEADING_CLASS = 'PargrafoAlterador-titulo'

/** "Redação do inciso VIII sem efeitos a partir de …" (o pivô não importa para reconhecer). */
function isWithoutEffectNote(text: string): boolean {
  return /sem\s+efeito/i.test(text) && parseWithoutEffectNote(text, 0) !== null
}

function roleOf(paragraph: Paragraph): Role {
  const { className, text } = paragraph
  if (className === 'TitCentral' || className === ADDED_HEADING_CLASS) {
    return 'heading'
  }
  if (className === 'NovaRedao' || className === 'NovaRedRev') {
    return 'amendment'
  }
  // Vem em `NotaDisc*` e, por erro da fonte, em `TextoRevo` ("1. Redação do inciso IX sem efeitos
  // de 23.06.22 a 29.04.23"), onde o "1." viraria um item.
  if (isWithoutEffectNote(text)) {
    return 'without-effect'
  }
  if (className === 'NotaVigncia' || className === 'NotaVigor') {
    // Texto de artigo publicado com a classe da nota (erro da fonte) vale como redação superada;
    // "1. Redação com vigência…" é nota numerada, não item.
    return parseLabel(text)?.kind === 'art' ? 'text' : 'validity-note'
  }
  if (TEXT_CLASSES.has(className)) {
    if (/^notas?\s*:?$/i.test(text)) {
      // Cabeçalho "NOTAS:" de uma lista de notas publicado em `TextoRevo`: não é texto da redação.
      return 'editorial'
    }
    return headingLevel(text) !== null && parseLabel(text) === null ? 'heading' : 'text'
  }
  return 'editorial'
}

function isSupersededClass(className: string): boolean {
  return className === 'TextoRevo' || className === 'NotaVigncia' || className === 'NotaVigor'
}

interface NoteRecord {
  /** `nota`: parágrafo `NotaVigncia`/`NotaVigor`; `inline`: parêntese no fim do texto. */
  readonly kind: 'nota' | 'inline'
  readonly rawNote: string
  status: 'parsed' | 'review'
}

/** Uma redação encontrada no documento, antes da resolução das datas. */
interface Draft {
  key: string
  segments: readonly Segment[]
  /** Rótulo com que a redação foi publicada (difere de `segments` depois de uma renumeração). */
  readonly displaySegments: readonly Segment[]
  readonly superseded: boolean
  text: string
  readonly order: number
  /** "RCTE > TÍTULO III - … > Subseção IV - Do Prazo" (sem o final do dispositivo). */
  readonly headingPrefix: string
  readonly amendment: AmendmentNote | null
  readonly amendmentOwn: boolean
  readonly amendmentFrom: IsoDate | null
  inline: InlineNote | null
  /** Período da nota de vigência que fechou a redação (datas legíveis, mesmo se a nota foi
   * para revisão). */
  noteFirst: IsoDate | null
  noteLast: IsoDate | null
  noteWithoutValidity: boolean
  closedByNote: boolean
  noteRaw: string | null
  /** Nota "sem efeitos" que atinge a redação. */
  withoutEffect: VersionCandidate['withoutEffect']
  readonly parent: Draft | null
  readonly marks: ReviewMark[]
  readonly noteRefs: NoteRecord[]
}

interface ScopeEntry {
  readonly target: readonly Segment[]
  readonly targetKey: string
  readonly from: IsoDate | null
  readonly amendment: AmendmentNote | null
  readonly caputOnly: boolean
  /** Ordem do dispositivo em que a nota foi ligada (só vale para redações publicadas depois). */
  readonly order: number
}

interface PendingAmendment {
  readonly note: AmendmentNote
  readonly superseded: boolean
}

interface Renumbering {
  readonly oldSegments: readonly Segment[]
  readonly newKey: string
  readonly effectiveFrom: IsoDate | null
}

interface Header {
  readonly consolidatedUntil: string
  readonly publishedOn: IsoDate
}

const HEADER =
  /(?:CONSOLIDADO|ATUALIZADO)\s+AT[ÉE]\s+(?:O|A)\s+(DECRETO|LEI)\s+N[º°o]?\s*([\d.]+),?\s+DE\s+(\d{1,2}\.\d{1,2}\.\d{2,4})/i
const END_OF_BODY = /^PAL[ÁA]CIO DO GOVERNO/i

const NOTE_RELATED: ReadonlySet<string> = new Set([
  ReviewReason.NoteUnparsed,
  ReviewReason.NoteDateIllegible,
  ReviewReason.NoteAmbiguous,
  ReviewReason.NoteOrphan,
  ReviewReason.InlineUnparsed,
  ReviewReason.OpeningMismatch,
  ReviewReason.IntervalInverted,
])

class StateMachine {
  readonly drafts: Draft[] = []
  readonly notes: NoteRecord[] = []
  /** Notas "sem efeitos" (fora de `notes`: o `ParseStats` conta as notas de vigência). */
  readonly withoutEffectNotes: NoteRecord[] = []
  readonly renumberings: Renumbering[] = []
  readonly orphanNotes: string[] = []
  header: Header | null = null
  /** "PALÁCIO DO GOVERNO…": fim do corpo do decreto. */
  ended = false
  /** Contagem de parágrafos de texto sem rótulo e sem dispositivo a que se juntar (diagnóstico). */
  unattached = 0
  /** Notas de vigência da redação de títulos (fora das contagens). */
  headingNotes = 0

  private readonly headings: (string | null)[] = [null, null, null, null, null]
  private pendingHeadingLevel: number | null = null
  /** Classe do rótulo do título pendente: título de estrutura superada vem em `TextoRevo`. */
  private pendingHeadingClass = ''
  private afterHeading = false
  private context: Segment[] = []
  private scope: ScopeEntry[] = []
  private pending: PendingAmendment[] = []
  private group: Draft[] = []
  private lastDraft: Draft | null = null
  private lastDraftOpen = false
  private readonly lastByKey = new Map<string, Draft>()
  private order = 0

  private readonly profile: ConsolidatedProfile

  constructor(profile: ConsolidatedProfile) {
    this.profile = profile
  }

  feed(paragraph: Paragraph): void {
    switch (roleOf(paragraph)) {
      case 'heading':
        this.onHeading(paragraph)
        break
      case 'amendment':
        this.onAmendment(paragraph)
        break
      case 'validity-note':
        this.onValidityNote(paragraph.text)
        break
      case 'without-effect':
        this.onWithoutEffect(paragraph.text)
        break
      case 'text':
        this.onText(paragraph)
        break
      default:
        break
    }
  }

  readHeader(text: string): void {
    const match = HEADER.exec(text)
    if (this.header !== null || match === null) {
      return
    }
    const publishedOn = parseNoteDate(match[3] ?? '', this.profile.yearPivot)
    if (publishedOn === null) {
      return
    }
    const kind = (match[1] ?? '').toUpperCase() === 'LEI' ? 'Lei' : 'Decreto'
    const [day, month, year] = (match[3] ?? '').split('.')
    this.header = {
      consolidatedUntil: `${kind} nº ${match[2]}, de ${day?.padStart(2, '0')}.${month?.padStart(2, '0')}.${year}`,
      publishedOn,
    }
  }

  private onHeading(paragraph: Paragraph): void {
    const text = extractInlineNote(paragraph.text, this.profile.yearPivot).text
    const level = headingLevel(text)
    this.closeGroup()
    this.pending = []
    this.lastDraftOpen = false
    const wasAfterHeading = this.afterHeading
    this.afterHeading = true
    if (level !== null) {
      // `setHeading` zera os níveis abaixo: um capítulo novo não herda seção nem subseção.
      this.setHeading(level, text)
      this.pendingHeadingLevel = level
      this.pendingHeadingClass = paragraph.className
      return
    }
    if (this.pendingHeadingLevel !== null) {
      this.setTitle(text)
      return
    }
    if (!wasAfterHeading) {
      // Título sem rótulo depois de dispositivos ("DISPOSIÇÕES FINAIS E TRANSITÓRIAS"): no nível
      // do Título. Logo depois de um rótulo com outros parágrafos no meio (ex.: título de seção
      // com redação alterada), fica de fora, como na fixture da F2.
      this.setHeading(1, text)
    }
  }

  private setTitle(text: string): void {
    if (this.pendingHeadingLevel !== null) {
      const label = this.headings[this.pendingHeadingLevel]
      this.headings[this.pendingHeadingLevel] = `${label} - ${text}`
    }
    this.pendingHeadingLevel = null
  }

  private setHeading(level: number, text: string): void {
    this.headings[level] = text
    for (let lower = level + 1; lower < this.headings.length; lower += 1) {
      this.headings[lower] = null
    }
  }

  private onAmendment(paragraph: Paragraph): void {
    this.pendingHeadingLevel = null
    this.closeGroup()
    this.lastDraftOpen = false
    this.pending.push({
      note: parseAmendmentNote(paragraph.text, this.profile.yearPivot),
      superseded: paragraph.className === 'NovaRedRev',
    })
  }

  private onValidityNote(raw: string): void {
    this.pendingHeadingLevel = null
    const note = parseValidityNote(raw, this.profile.yearPivot)
    if (note.kind === 'not-validity') {
      return
    }
    this.lastDraftOpen = false
    const targets = this.noteTargets()
    if (targets.length === 0) {
      this.onOrphanNote(raw)
      return
    }
    const record: NoteRecord = { kind: 'nota', rawNote: raw, status: 'parsed' }
    this.notes.push(record)
    const rawNote = raw.replace(/\s+/g, ' ').trim()
    for (const draft of targets) {
      draft.noteRefs.push(record)
      draft.noteRaw = rawNote
      applyNote(draft, note)
      if (note.kind === 'unparsed' && !resolvedByOwnAct(draft, note)) {
        draft.marks.push({ reason: note.reason, rawNote })
        record.status = 'review'
      }
      if (!draft.superseded && note.kind !== 'start') {
        draft.marks.push({ reason: ReviewReason.StyleMismatch, rawNote })
      }
    }
    this.group = []
  }

  /**
   * Redações que a nota fecha: o grupo aberto (a sequência de redações da mesma classe logo antes
   * dela), menos as que já se fecharam com nota inline ou nota própria. Se todas já estão
   * fechadas, a nota vai para a última (e a divergência, se houver, para a revisão).
   */
  private noteTargets(): Draft[] {
    const open = this.group.filter((draft) => !draft.closedByNote && draft.inline?.last == null)
    const last = this.group.at(-1)
    return open.length > 0 || last === undefined ? open : [last]
  }

  /**
   * Nota "Redação d… <rótulo> sem efeitos a partir de …": o rótulo, lido na estrutura corrente, dá
   * o dispositivo; a redação atingida é a primeira ainda sem fim publicada depois da última redação
   * do pai (a nota vem depois da redação vigente, às vezes de um "dispositivo declarado
   * inconstitucional" que não tem abertura). Não fecha o grupo: a `NotaVigncia` seguinte, se houver,
   * continua valendo para as redações superadas.
   */
  private onWithoutEffect(raw: string): void {
    this.pendingHeadingLevel = null
    this.lastDraftOpen = false
    const note = parseWithoutEffectNote(raw, this.profile.yearPivot)
    const rawNote = raw.replace(/\s+/g, ' ').trim()
    const record: NoteRecord = { kind: 'nota', rawNote: raw, status: 'parsed' }
    this.withoutEffectNotes.push(record)
    const label = note === null ? null : labelFromPhrase(note.label)
    const target = label === null ? null : this.withoutEffectTarget(label)
    const draft = target ?? this.lastDraft
    if (draft === null) {
      record.status = 'review'
      this.orphanNotes.push(rawNote)
      return
    }
    draft.noteRefs.push(record)
    if (target === null || note?.from == null || draft.withoutEffect !== null) {
      // Rótulo que não casa com a estrutura, data ilegível ou segunda nota para a mesma redação.
      const reason =
        target === null
          ? ReviewReason.NoteOrphan
          : note?.from == null
            ? ReviewReason.NoteUnparsed
            : ReviewReason.NoteAmbiguous
      record.status = 'review'
      draft.marks.push({ reason, rawNote })
      return
    }
    draft.withoutEffect = { from: note.from, until: note.until, rawNote }
  }

  private withoutEffectTarget(label: Segment): Draft | null {
    const depth = ORDER.indexOf(label.kind)
    const segments = [
      ...this.context.filter((segment) => ORDER.indexOf(segment.kind) < depth),
      label,
    ]
    if (segments[0]?.kind !== 'art') {
      return null
    }
    const key = draftKeyOf(this.profile.family, segments)
    const parentOrder =
      segments.length > 1
        ? (this.lastByKey.get(draftKeyOf(this.profile.family, segments.slice(0, -1)))?.order ?? -1)
        : -1
    const drafts = this.drafts.filter((draft) => draft.key === key && draft.order > parentOrder)
    return drafts.find(isOpenEnded) ?? drafts.at(-1) ?? null
  }

  private onOrphanNote(raw: string): void {
    if (this.afterHeading) {
      // Nota da redação de um título (ex.: "Seção III"), que não é dispositivo: fora das contagens.
      this.headingNotes += 1
      return
    }
    const rawNote = raw.replace(/\s+/g, ' ').trim()
    const record: NoteRecord = { kind: 'nota', rawNote: raw, status: 'review' }
    this.notes.push(record)
    if (this.lastDraft === null) {
      this.orphanNotes.push(rawNote)
      return
    }
    this.lastDraft.marks.push({ reason: ReviewReason.NoteOrphan, rawNote })
    this.lastDraft.noteRefs.push(record)
  }

  private closeGroup(): void {
    this.group = []
  }

  private onText(paragraph: Paragraph): void {
    if (END_OF_BODY.test(paragraph.text)) {
      this.ended = true
      return
    }
    const label = parseLabel(paragraph.text)
    if (
      label === null &&
      this.pendingHeadingLevel !== null &&
      this.pendingHeadingClass === paragraph.className
    ) {
      this.setTitle(paragraph.text)
      return
    }
    this.pendingHeadingLevel = null
    const segments = label === null ? null : this.locate(label)
    if (segments === null) {
      this.onContinuation(paragraph)
      return
    }
    this.afterHeading = false
    this.addDraft(segments, paragraph)
  }

  /** Posição do rótulo na estrutura corrente (artigo > § > inciso > alínea > item). */
  private locate(label: Segment): Segment[] | null {
    if (label.kind === 'art') {
      this.context = [label]
      return [...this.context]
    }
    if (this.context.length === 0) {
      return null
    }
    const depth = ORDER.indexOf(label.kind)
    const kept = this.context.filter((segment) => ORDER.indexOf(segment.kind) < depth)
    this.context = [...kept, label]
    return [...this.context]
  }

  private onContinuation(paragraph: Paragraph): void {
    const draft = this.lastDraft
    if (
      this.afterHeading ||
      draft === null ||
      !this.lastDraftOpen ||
      draft.superseded !== isSupersededClass(paragraph.className)
    ) {
      this.unattached += 1
      return
    }
    const { text, note } = extractInlineNote(paragraph.text, this.profile.yearPivot)
    draft.text = `${draft.text}\n${text}`
    if (note !== null && draft.inline === null) {
      this.attachInline(draft, note)
    }
  }

  private addDraft(segments: Segment[], paragraph: Paragraph): void {
    const key = draftKeyOf(this.profile.family, segments)
    this.scope = this.scope.filter((entry) => isAncestorOrSelf(entry.target, segments))
    const superseded = isSupersededClass(paragraph.className)
    const styleMismatch = this.pending.length > 0 && this.pending.at(-1)?.superseded !== superseded
    const own = this.bindPending(segments, key)
    const inherited = own === null ? this.inheritedEntry(segments, key) : null
    const { text, note: inline } = extractInlineNote(paragraph.text, this.profile.yearPivot)
    const parentDraft =
      segments.length > 1
        ? this.lastByKey.get(draftKeyOf(this.profile.family, segments.slice(0, -1)))
        : undefined
    const draft: Draft = {
      key,
      segments,
      displaySegments: segments,
      superseded,
      text,
      order: this.order,
      headingPrefix: this.headingPrefix(),
      amendment: own ?? inherited?.amendment ?? null,
      amendmentOwn: own !== null,
      amendmentFrom: own === null ? (inherited?.from ?? null) : openingOf(own, superseded),
      inline: null,
      noteFirst: null,
      noteLast: null,
      noteWithoutValidity: false,
      closedByNote: false,
      noteRaw: null,
      withoutEffect: null,
      parent: parentDraft?.superseded === true ? parentDraft : null,
      // `NovaRedRev` abre redação superada (`TextoRevo`); `NovaRedao`, a vigente.
      marks:
        own !== null && styleMismatch
          ? [{ reason: ReviewReason.StyleMismatch, rawNote: own.rawNote }]
          : [],
      noteRefs: [],
    }
    this.order += 1
    if (own?.renumberedFrom != null) {
      this.renumber(draft, own.renumberedFrom, own.effectiveFrom)
    }
    if (inline !== null) {
      this.attachInline(draft, inline)
    }
    this.drafts.push(draft)
    if (this.group.at(-1)?.superseded !== superseded) {
      this.group = []
    }
    this.group.push(draft)
    this.lastDraft = draft
    this.lastDraftOpen = true
    this.lastByKey.set(key, draft)
  }

  /** Liga as notas de alteração pendentes ao primeiro dispositivo depois delas. */
  private bindPending(segments: readonly Segment[], key: string): AmendmentNote | null {
    const notes = this.pending.map((entry) => entry.note)
    this.pending = []
    const dated = notes.filter((note) => note.effectiveFrom !== null || note.exhausted)
    const main = dated.at(-1) ?? notes.at(-1)
    if (main === undefined) {
      return null
    }
    const renumberedFrom =
      notes.find((note) => note.renumberedFrom !== null)?.renumberedFrom ?? null
    const merged: AmendmentNote = { ...main, renumberedFrom }
    this.scope.push({
      target: segments,
      targetKey: key,
      from: merged.effectiveFrom,
      amendment: merged,
      caputOnly: merged.caputOnly,
      order: this.order,
    })
    return merged
  }

  /**
   * Abertura herdada: a nota mais recente de um ancestral, nunca a de "nova redação ao caput". Um
   * filho que já tem redação publicada depois da nota do pai não herda a abertura dela: a redação
   * nova dele precisa de nota própria (senão, revisão).
   */
  private inheritedEntry(segments: readonly Segment[], key: string): ScopeEntry | null {
    const lastOwn = this.lastByKey.get(key)?.order ?? -1
    for (let index = this.scope.length - 1; index >= 0; index -= 1) {
      const entry = this.scope[index]
      if (
        entry !== undefined &&
        entry.targetKey !== key &&
        !entry.caputOnly &&
        isAncestorOrSelf(entry.target, segments)
      ) {
        return entry.order > lastOwn ? entry : null
      }
    }
    return null
  }

  private attachInline(draft: Draft, note: InlineNote): void {
    draft.inline = note
    const record: NoteRecord = {
      kind: 'inline',
      rawNote: note.rawNote,
      status: note.unparsed ? 'review' : 'parsed',
    }
    this.notes.push(record)
    draft.noteRefs.push(record)
    if (note.unparsed) {
      draft.marks.push({ reason: ReviewReason.InlineUnparsed, rawNote: note.rawNote })
    }
    if (note.changeKind === ChangeKind.Acrescimo && note.first !== null) {
      this.scope.push({
        target: draft.segments,
        targetKey: draft.key,
        from: note.first,
        amendment: null,
        caputOnly: false,
        order: draft.order,
      })
    }
    if (note.renumberedFrom !== null) {
      this.renumber(draft, note.renumberedFrom, note.first)
    }
  }

  /**
   * Renumeração: as redações superadas publicadas com o rótulo antigo (depois da última vigente
   * com esse rótulo) passam para a chave do rótulo atual, uma chave para a história toda; o
   * rótulo antigo vira `labels`.
   */
  private renumber(target: Draft, phrase: string, effectiveFrom: IsoDate | null): void {
    const { segments } = target
    const oldLabel = labelFromPhrase(phrase)
    const last = segments.at(-1)
    if (oldLabel === null || last === undefined || oldLabel.kind !== last.kind) {
      target.marks.push({ reason: ReviewReason.RenumberingUnresolved, rawNote: phrase })
      return
    }
    const oldSegments = [...segments.slice(0, -1), oldLabel]
    const oldKey = draftKeyOf(this.profile.family, oldSegments)
    if (oldKey === target.key) {
      return
    }
    this.renumberings.push({ oldSegments, newKey: target.key, effectiveFrom })
    const lastCurrent = this.drafts.findLastIndex(
      (draft) => draft.key === oldKey && !draft.superseded,
    )
    for (const draft of this.drafts.slice(lastCurrent + 1)) {
      if (draft.superseded && isAncestorOrSelf(oldSegments, draft.segments)) {
        draft.segments = [...segments, ...draft.segments.slice(oldSegments.length)]
        draft.key = draftKeyOf(this.profile.family, draft.segments)
      }
    }
  }

  private headingPrefix(): string {
    const headings = this.headings.slice(1).filter((heading): heading is string => heading !== null)
    return [this.profile.prefix, ...headings].join(' > ')
  }
}

function labelFromPhrase(phrase: string): Segment | null {
  if (/^(?:paragrafo|§) ?unico/.test(phrase)) {
    return { kind: 'par', value: 'unico' }
  }
  const paragraph = /^§ ?(\d{1,2}) ?[º°o]?(?: ?- ?([a-z]))?$/.exec(phrase)
  if (paragraph !== null) {
    return { kind: 'par', value: suffixed(paragraph[1], paragraph[2]) }
  }
  const inciso = /^inciso ([ivxlc]{1,8})(?: ?- ?([a-z]))?$/.exec(phrase)
  if (inciso !== null && ROMAN.test((inciso[1] ?? '').toUpperCase())) {
    return { kind: 'inc', value: suffixed(inciso[1]?.toUpperCase(), inciso[2]) }
  }
  const alinea = /^alinea "?([a-z])"?$/.exec(phrase)
  if (alinea !== null) {
    return { kind: 'ali', value: alinea[1] ?? '' }
  }
  const item = /^item (\d{1,3})$/.exec(phrase)
  return item === null ? null : { kind: 'item', value: itemValue(item[1] ?? '', undefined) }
}

// ---------------------------------------------------------------------------------------------
// Montagem das versões

interface BuiltVersion extends TimedText {
  readonly draft: Draft
  readonly amendment: ParsedAmendment | undefined
  readonly retroactive: boolean
}

function toCandidate(draft: Draft, parentBlock: ValidityInterval | null): VersionCandidate {
  const own = draft.amendmentOwn ? draft.amendment : null
  return {
    text: draft.text,
    superseded: draft.superseded,
    amendmentFrom: draft.amendmentFrom,
    amendmentOwn: draft.amendmentOwn,
    amendmentUntil: own?.until ?? null,
    exhausted: own?.exhausted === true,
    inlineFirst: draft.inline?.first ?? null,
    inlineLast: draft.inline?.last ?? null,
    noteFirst: draft.noteFirst,
    noteLast: draft.noteLast,
    withoutValidity: draft.noteWithoutValidity || draft.inline?.withoutValidity === true,
    parentBlock,
    withoutEffect: draft.withoutEffect,
    marks: draft.marks,
  }
}

function amendmentOf(draft: Draft, from: IsoDate): ParsedAmendment | undefined {
  const note = draft.amendment
  if (
    note === null ||
    note.effectiveFrom !== from ||
    note.changeKind === null ||
    note.act?.date == null
  ) {
    return undefined
  }
  return {
    actLabel: note.act.label,
    actKind: note.act.kind,
    actDate: note.act.date,
    effectiveFrom: note.effectiveFrom,
    changeKind: note.changeKind,
    rawNote: note.rawNote,
  }
}

function reviewNote(draft: Draft, mark: ReviewMark): string | null {
  return mark.rawNote ?? draft.noteRaw ?? draft.inline?.rawNote ?? draft.amendment?.rawNote ?? null
}

interface Assembly {
  readonly provisions: ParsedProvision[]
  readonly skipped: SkippedVersion[]
  /** Versões que foram para revisão (para saber quais notas contam como não convertidas). */
  readonly reviewed: BuiltVersion[]
}

function assemble(machine: StateMachine, profile: ConsolidatedProfile): Assembly {
  const byKey = new Map<string, Draft[]>()
  for (const draft of machine.drafts) {
    const list = byKey.get(draft.key) ?? []
    list.push(draft)
    byKey.set(draft.key, list)
  }
  const keys = [...byKey.keys()].sort((a, b) => a.split(':').length - b.split(':').length)
  const resolvedByDraft = new Map<Draft, ValidityInterval>()
  const renumbered = new Set(machine.renumberings.map((entry) => entry.newKey))
  const versionsByKey = new Map<string, BuiltVersion[]>()
  const skipped: SkippedVersion[] = []
  for (const key of keys) {
    const drafts = byKey.get(key) ?? []
    if (key.startsWith(INVALID_KEY_PREFIX)) {
      for (const draft of drafts) {
        skipped.push({
          stableKey: null,
          reason: INVALID_KEY_REASON,
          rawNote: draft.text.slice(0, 80),
        })
      }
      continue
    }
    const built = resolveKey(drafts, profile, resolvedByDraft, skipped)
    versionsByKey.set(
      key,
      finishVersions(built, key, profile, { versionsByKey, renumbered, skipped }),
    )
  }
  const firstOrder = (key: string): number => byKey.get(key)?.[0]?.order ?? 0
  const provisions = [...versionsByKey.entries()]
    .filter(([, versions]) => versions.length > 0)
    .sort(([a], [b]) => firstOrder(a) - firstOrder(b))
    .map(([key, versions]) => toProvision(key, versions, profile, machine, versionsByKey))
  const reviewed = [...versionsByKey.values()].flat().filter((version) => version.review !== null)
  return { provisions, skipped, reviewed }
}

function resolveKey(
  drafts: readonly Draft[],
  profile: ConsolidatedProfile,
  resolvedByDraft: Map<Draft, ValidityInterval>,
  skipped: SkippedVersion[],
): BuiltVersion[] {
  const candidates = drafts.map((draft) =>
    toCandidate(draft, draft.parent === null ? null : (resolvedByDraft.get(draft.parent) ?? null)),
  )
  const timeline = resolveTimeline(candidates, { originalFrom: profile.originalFrom })
  for (const entry of timeline.skipped) {
    const draft = drafts[entry.index]
    skipped.push({
      stableKey: draft?.key ?? null,
      reason: entry.reason,
      rawNote: draft?.noteRaw ?? draft?.inline?.rawNote ?? null,
    })
  }
  return timeline.versions.flatMap((resolved) => {
    const draft = drafts[resolved.index]
    if (draft === undefined) {
      return []
    }
    if (resolved.review === null || resolved.review.reason !== ReviewReason.EndMissing) {
      // Redação partida por uma nota "sem efeitos de a a b": o bloco do pai vai do início da
      // primeira parte ao fim da última.
      const earlier = resolvedByDraft.get(draft)
      resolvedByDraft.set(
        draft,
        earlier === undefined
          ? resolved.validDuring
          : { from: earlier.from, to: resolved.validDuring.to },
      )
    }
    const from = resolved.validDuring.from ?? profile.originalFrom
    const amendment = amendmentOf(draft, from)
    return [
      {
        draft,
        text: draft.text,
        validDuring: resolved.validDuring,
        review:
          resolved.review === null
            ? null
            : { ...resolved.review, rawNote: reviewNote(draft, resolved.review) },
        amendment,
        retroactive:
          amendment === undefined
            ? false
            : isRetroactive(amendment.effectiveFrom, amendment.actDate),
      },
    ]
  })
}

function finishVersions(
  built: readonly BuiltVersion[],
  key: string,
  profile: ConsolidatedProfile,
  context: {
    readonly versionsByKey: ReadonlyMap<string, readonly BuiltVersion[]>
    readonly renumbered: ReadonlySet<string>
    readonly skipped: SkippedVersion[]
  },
): BuiltVersion[] {
  const { versionsByKey, renumbered, skipped } = context
  let versions = flagOverlaps(mergeIdenticalConsecutive(built))
  if (profile.restructuredOn !== null) {
    const cut = applyRestructuringCut(versions, profile.restructuredOn)
    versions = cut.versions
    for (const version of cut.clipped) {
      skipped.push({
        stableKey: key,
        reason: SkipReason.ClippedAtRestructuring,
        rawNote: version.draft.noteRaw ?? version.draft.inline?.rawNote ?? null,
      })
    }
  }
  const parentKey = key.split(':').slice(0, -2).join(':')
  // Pai renumerado existia antes com outro rótulo: a comparação não vale.
  const parentVersions = renumbered.has(parentKey) ? undefined : versionsByKey.get(parentKey)
  const parentStart = parentVersions
    ?.map((version) => version.validDuring.from)
    .filter((from): from is IsoDate => from !== null)
    .sort(compareCodeUnits)[0]
  return versions.map((version) =>
    version.review === null &&
    parentStart !== undefined &&
    version.validDuring.from !== null &&
    version.validDuring.from < parentStart
      ? {
          ...version,
          review: {
            reason: ReviewReason.BeforeParent,
            rawNote: reviewNote(version.draft, {
              reason: ReviewReason.BeforeParent,
              rawNote: null,
            }),
          },
        }
      : version,
  )
}

function toParsedVersion(version: BuiltVersion, profile: ConsolidatedProfile): ParsedVersion {
  const { from, to } = version.validDuring
  return {
    displayLabel: displayLabelOf(profile.prefix, version.draft.displaySegments),
    validDuring: { from: from ?? profile.originalFrom, to },
    modality: Modality.Mandatory,
    validityBasis: ValidityBasis.LegalEffect,
    retroactive: version.retroactive,
    reviewStatus: version.review === null ? ReviewStatus.Auto : ReviewStatus.Pending,
    review:
      version.review === null
        ? undefined
        : { reason: version.review.reason, rawNote: version.review.rawNote },
    text: version.text,
    amendment: version.amendment,
  }
}

function labelsOf(
  key: string,
  versions: readonly BuiltVersion[],
  profile: ConsolidatedProfile,
  machine: StateMachine,
): ParsedLabel[] | undefined {
  const renumbering = machine.renumberings.find((entry) => entry.newKey === key)
  const current = versions[0]?.draft.segments
  if (renumbering === undefined || renumbering.effectiveFrom === null || current === undefined) {
    return undefined
  }
  const oldStarts = versions
    .filter((version) => version.draft.displaySegments !== version.draft.segments)
    .map((version) => version.validDuring.from)
    .filter((from): from is IsoDate => from !== null)
    .sort(compareCodeUnits)
  const oldFrom = oldStarts[0] ?? null
  const labels: ParsedLabel[] = [
    {
      label: displayLabelOf(profile.prefix, current),
      validDuring: { from: renumbering.effectiveFrom, to: null },
    },
  ]
  if (oldFrom === null || oldFrom < renumbering.effectiveFrom) {
    labels.unshift({
      label: displayLabelOf(profile.prefix, renumbering.oldSegments),
      validDuring: { from: oldFrom, to: renumbering.effectiveFrom },
    })
  }
  return labels
}

function toProvision(
  key: string,
  versions: readonly BuiltVersion[],
  profile: ConsolidatedProfile,
  machine: StateMachine,
  versionsByKey: ReadonlyMap<string, readonly BuiltVersion[]>,
): ParsedProvision {
  const segments = versions[0]?.draft.segments ?? []
  const parentKey = segments.length > 1 ? keyOf(profile.family, segments.slice(0, -1)) : undefined
  // Os títulos são os do lugar da redação vigente do artigo: redações antigas às vezes ficam num
  // bloco com a estrutura anterior (ex.: CTE antes da Lei 12.972/96).
  const articleKey = segments.length > 1 ? keyOf(profile.family, segments.slice(0, 1)) : key
  const articleVersions = versionsByKey.get(articleKey) ?? versions
  const located =
    articleVersions.findLast((version) => !version.draft.superseded) ?? articleVersions.at(-1)
  return {
    stableKey: key,
    kind: KIND_NAMES[segments.at(-1)?.kind ?? 'art'],
    parent: parentKey !== undefined && versionsByKey.has(parentKey) ? parentKey : undefined,
    sortPath: sortPathOf(segments),
    headingPath: `${located?.draft.headingPrefix ?? profile.prefix} > ${headingTailOf(segments)}`,
    labels: labelsOf(key, versions, profile, machine),
    versions: versions.map((version) => toParsedVersion(version, profile)),
  }
}

// ---------------------------------------------------------------------------------------------
// Parser

function profileOf(input: ParserInput): ConsolidatedProfile {
  const family = input.source.family
  if (family !== Family.Rcte && family !== Family.Cte) {
    throw new ParseError(`go-html-state-machine só lê RCTE e CTE (família ${family})`)
  }
  const base = PROFILES[family]
  return {
    ...base,
    yearPivot: input.source.yearPivot ?? base.yearPivot,
    originalFrom: input.source.effectiveFrom ?? base.originalFrom,
    actRef: input.source.actRef ?? base.actRef,
  }
}

function inSliceFilter(profile: ConsolidatedProfile): (paragraph: Paragraph) => boolean {
  const slice = profile.slice
  if (slice === null) {
    return () => true
  }
  let state: 'before' | 'inside' | 'after' = 'before'
  return (paragraph) => {
    if (
      paragraph.className === 'TitCentral' &&
      state === 'before' &&
      slice.start.test(paragraph.text)
    ) {
      state = 'inside'
    } else if (
      paragraph.className === 'TitCentral' &&
      state === 'inside' &&
      slice.end.test(paragraph.text)
    ) {
      state = 'after'
    }
    return state === 'inside'
  }
}

/** Notas que foram para revisão por causa da própria nota (e não por outra regra). */
function finalizeNoteStatus(reviewed: readonly BuiltVersion[]): void {
  for (const version of reviewed) {
    if (version.review !== null && NOTE_RELATED.has(version.review.reason)) {
      for (const record of version.draft.noteRefs) {
        record.status = 'review'
      }
    }
  }
}

/** Contagem de notas por origem (o DoD da F3 mede só as `NotaVigncia`). */
interface NoteCounts {
  readonly total: number
  readonly parsed: number
  readonly toReview: number
}

/** Números da leitura que não cabem no `ParsedSource` (medição do DoD, relatório do `load`). */
export interface ConsolidatedDiagnostics {
  readonly validityNotes: NoteCounts
  readonly inlineNotes: NoteCounts
  /** Notas "Redação … sem efeitos a partir de …" (fora de `stats`). */
  readonly withoutEffectNotes: NoteCounts
  /** Notas de vigência de títulos (não são dispositivos): fora de `stats`. */
  readonly headingNotes: number
  /** Parágrafos de texto sem rótulo e sem redação aberta a que se juntar. */
  readonly unattachedParagraphs: number
  /** Rótulos fora da gramática da `stable_key` (ex.: "Art. 167-S-B"). */
  readonly invalidLabels: number
}

function countNotes(notes: readonly NoteRecord[], kind: NoteRecord['kind']): NoteCounts {
  const ofKind = notes.filter((note) => note.kind === kind)
  const toReview = ofKind.filter((note) => note.status === 'review').length
  return { total: ofKind.length, parsed: ofKind.length - toReview, toReview }
}

/** O parser com os números de diagnóstico (usado pela medição sobre os arquivos inteiros). */
export function parseConsolidatedWithDiagnostics(input: ParserInput): {
  readonly source: ParsedSource
  readonly diagnostics: ConsolidatedDiagnostics
} {
  const profile = profileOf(input)
  const machine = new StateMachine(profile)
  const inSlice = inSliceFilter(profile)
  for (const paragraph of readParagraphs(input.bytes)) {
    machine.readHeader(paragraph.text)
    if (inSlice(paragraph) && !machine.ended) {
      machine.feed(paragraph)
    }
  }
  const header = machine.header
  const publishedOn = header?.publishedOn ?? input.source.publishedOn
  if (publishedOn === null) {
    throw new ParseError(
      `cabeçalho "consolidado/atualizado até" não encontrado em ${input.source.id}`,
    )
  }
  const { provisions, skipped, reviewed } = assemble(machine, profile)
  finalizeNoteStatus(reviewed)
  for (const rawNote of machine.orphanNotes) {
    skipped.push({ stableKey: null, reason: ReviewReason.NoteOrphan, rawNote })
  }
  const notesToReview = machine.notes.filter((note) => note.status === 'review').length
  const source: ParsedSource = {
    document: input.source.document,
    version: {
      versionLabel:
        header === null
          ? (input.source.versionLabel ?? `${profile.versionLabelLead} ${publishedOn}`)
          : `${profile.versionLabelLead} ${header.consolidatedUntil}`,
      publishedOn,
      validDuring: { from: publishedOn, to: null },
      consolidatedUntil: header?.consolidatedUntil ?? null,
      actRef: profile.actRef,
      sha256: input.sha256,
    },
    replacementWindow: { from: null, to: null },
    provisions,
    skipped,
    stats: {
      notesTotal: machine.notes.length,
      notesParsed: machine.notes.length - notesToReview,
      notesToReview,
    },
  }
  return {
    source,
    diagnostics: {
      validityNotes: countNotes(machine.notes, 'nota'),
      inlineNotes: countNotes(machine.notes, 'inline'),
      withoutEffectNotes: countNotes(machine.withoutEffectNotes, 'nota'),
      headingNotes: machine.headingNotes,
      unattachedParagraphs: machine.unattached,
      invalidLabels: skipped.filter((entry) => entry.reason === INVALID_KEY_REASON).length,
    },
  }
}

/** Parser `go-html-state-machine` (RCTE e CTE), registrado em `parsers/index.ts`. */
export const goHtmlStateMachineParser: Parser = (input) =>
  parseConsolidatedWithDiagnostics(input).source
