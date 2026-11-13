import {
  addDays,
  compareIntervals,
  fromCalendarDate,
  type IsoDate,
  overlaps,
  subtractIntervals,
  type ValidityInterval,
} from '@teko/shared/vigencia'
import { ChangeKind } from './family.ts'
import { normalizeForHash } from './text-normalization.ts'

/**
 * Regras de vigência dos consolidados (RCTE e CTE), puras e sem I/O. O parser
 * (`go-html-state-machine.ts`) percorre o HTML e entrega a este módulo o texto das notas e, por
 * dispositivo, a sequência de redações na ordem do documento; aqui ficam a leitura das notas, a
 * conversão de datas e intervalos e a montagem da linha do tempo de cada dispositivo.
 *
 * Intervalos sempre meio-abertos (`[from, to)`), com `to: null` para "em vigor" e nunca
 * `infinity`. As notas da fonte são inclusivas ("de 12.09.03 a 03.11.04"): `[a, b + 1)`.
 */

// ---------------------------------------------------------------------------------------------
// Datas

/** Ano de 2 dígitos pelo pivô do documento (97 no RCTE, 91 no CTE): `yy >= pivô` → 19yy. */
export function expandTwoDigitYear(twoDigits: number, pivot: number): number {
  const yy = twoDigits % 100
  return yy >= pivot % 100 ? 1900 + yy : 2000 + yy
}

/** `dd.mm.aa` ou `dd.mm.aaaa` → data ISO; `null` se o dia ou o mês não existirem. */
export function parseNoteDate(token: string, pivot: number): IsoDate | null {
  const match = DATE_TOKEN_EXACT.exec(token.trim())
  if (match === null) {
    return null
  }
  return dateFromParts(match[1] ?? '', match[2] ?? '', match[3] ?? '', pivot)
}

function dateFromParts(day: string, month: string, year: string, pivot: number): IsoDate | null {
  const fullYear = year.length <= 2 ? expandTwoDigitYear(Number(year), pivot) : Number(year)
  if (year.length === 3) {
    return null
  }
  try {
    return fromCalendarDate({ year: fullYear, month: Number(month), day: Number(day) })
  } catch {
    return null
  }
}

/**
 * Converte o período inclusivo da fonte em meio-aberto: `[first, last + 1)`. `last: null` = em
 * vigor. Devolve `null` quando o período é vazio ou invertido (`last < first`).
 */
export function inclusiveToHalfOpen(first: IsoDate, last: IsoDate | null): ValidityInterval | null {
  if (last === null) {
    return Object.freeze({ from: first, to: null })
  }
  if (last < first) {
    return null
  }
  return Object.freeze({ from: first, to: addDays(last, 1) })
}

/** `effectiveFrom` anterior à data do ato alterador: efeito retroativo. */
export function isRetroactive(effectiveFrom: IsoDate, actDate: IsoDate | null): boolean {
  return actDate !== null && effectiveFrom < actDate
}

// ---------------------------------------------------------------------------------------------
// Texto das notas

/**
 * Data com dia de até 3 dígitos: "230.09.03" (erro da fonte) casa e é recusada depois. O mês
 * aceita um zero a mais à esquerda ("31.010.07", erro da fonte sem ambiguidade: outubro).
 */
const DATE_TOKEN = String.raw`(\d{1,3})\s?\.\s?(0?\d{1,2})\s?\.\s?(\d{2,4})`
const DATE_TOKEN_EXACT = new RegExp(`^${DATE_TOKEN}$`)
const VIG = 'vig[a-z]{0,3}cia'

/**
 * Forma de comparação das notas: sem acentos (1 ou 2 bytes na fonte viram a mesma letra),
 * minúscula, travessões viram hífen e espaços colapsados. Só para casar padrões; o texto
 * publicado continua em `rawNote`.
 */
export function foldNote(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

interface DateHit {
  readonly index: number
  readonly end: number
  readonly date: IsoDate | null
}

function findDates(folded: string, pivot: number, from = 0): DateHit[] {
  const pattern = new RegExp(DATE_TOKEN, 'g')
  pattern.lastIndex = from
  const hits: DateHit[] = []
  for (let match = pattern.exec(folded); match !== null; match = pattern.exec(folded)) {
    hits.push({
      index: match.index,
      end: match.index + match[0].length,
      date: dateFromParts(match[1] ?? '', match[2] ?? '', match[3] ?? '', pivot),
    })
  }
  return hits
}

/** Leitura de uma nota de vigência (`NotaVigncia`, `NotaVigor`). */
export type ValidityNote =
  /** "Redação com vigência de a a b": período inclusivo `[first, last]`. */
  | {
      readonly kind: 'interval'
      readonly first: IsoDate
      readonly last: IsoDate
      /** O fim veio de uma prorrogação ("vigência original prorrogada para …"). */
      readonly extended: boolean
    }
  /** "Redação com vigência a partir de a": só o início. */
  | { readonly kind: 'start'; readonly first: IsoDate }
  /** "Redação sem vigência em função da alteração retroagir a …": intervalo vazio. */
  | { readonly kind: 'without-validity'; readonly retroactsTo: IsoDate | null }
  /** Nota de vigência que não deu para converter com segurança (vai para revisão). */
  | {
      readonly kind: 'unparsed'
      readonly reason: 'note-unparsed' | 'note-date-illegible' | 'note-ambiguous'
      /** Datas legíveis, quando há (ex.: o fim de "230.09.03 a 20.08.07"). */
      readonly first: IsoDate | null
      readonly last: IsoDate | null
    }
  /** Não é nota de vigência (cabeçalho "NOTAS:", nota editorial). Não entra nas contagens. */
  | { readonly kind: 'not-validity' }

/** Prefixo "NOTA:", "Notas:", "1.", "2." das notas numeradas. */
const NOTE_PREFIX = /^(?:notas?\s*[:.]?\s*)?(?:\d{1,2}\s*[.)-]?\s*)?/

/** Lê uma nota de vigência; o pivô resolve os anos de 2 dígitos. */
export function parseValidityNote(raw: string, pivot: number): ValidityNote {
  const body = foldNote(raw).replace(NOTE_PREFIX, '')
  if (/^redac\S*\s+sem\s+com\b/.test(body)) {
    return unparsedNote('note-ambiguous', body, pivot)
  }
  if (new RegExp(`^redac\\S*\\s+sem\\s*-?\\s*${VIG}`).test(body)) {
    const retro = /retroagir[^0-9]*/.exec(body)
    const hit = retro === null ? undefined : findDates(body, pivot, retro.index)[0]
    return { kind: 'without-validity', retroactsTo: hit?.date ?? null }
  }
  if (!new RegExp(`^(?:redac\\S*\\s+com\\s+)?${VIG}\\b`).test(body)) {
    return { kind: 'not-validity' }
  }
  return parseValidityBody(body, pivot)
}

function parseValidityBody(body: string, pivot: number): ValidityNote {
  const startOnly = new RegExp(`${VIG}\\s*:?\\s*a partir de\\s*${DATE_TOKEN}`).exec(body)
  if (startOnly !== null) {
    const first = findDates(body, pivot, startOnly.index)[0]?.date ?? null
    return first === null
      ? unparsedNote('note-date-illegible', body, pivot)
      : { kind: 'start', first }
  }
  const extension = /prorrogad[ao]\s+(?:para|ate)\s+/.exec(body)
  const main = findDates(extension === null ? body : body.slice(0, extension.index), pivot)
  const extendedTo =
    extension === null ? null : (findDates(body, pivot, extension.index)[0] ?? null)
  const [firstHit, lastHit] = main
  if (main.length !== 2 || firstHit === undefined || lastHit === undefined) {
    return unparsedNote(main.length > 2 ? 'note-ambiguous' : 'note-unparsed', body, pivot)
  }
  const between = body.slice(firstHit.end, lastHit.index).trim()
  if (!/^(?:a|ate|-|a a)?$/.test(between)) {
    return unparsedNote('note-ambiguous', body, pivot)
  }
  const last = extendedTo?.date ?? lastHit.date
  if (firstHit.date === null || last === null) {
    return unparsedNote('note-date-illegible', body, pivot)
  }
  return { kind: 'interval', first: firstHit.date, last, extended: extendedTo !== null }
}

function unparsedNote(
  reason: 'note-unparsed' | 'note-date-illegible' | 'note-ambiguous',
  body: string,
  pivot: number,
): ValidityNote {
  const hits = findDates(body, pivot)
  return {
    kind: 'unparsed',
    reason,
    first: hits.length >= 2 ? (hits[0]?.date ?? null) : null,
    last: hits.length >= 2 ? (hits[1]?.date ?? null) : null,
  }
}

// ---------------------------------------------------------------------------------------------
// Notas "Redação … sem efeitos a partir de …"

/**
 * Nota que tira o efeito de uma redação sem revogá-la nem substituí-la ("NOTA: Redação do inciso
 * VIII sem efeitos a partir de 23 de junho de 2022 em função da Lei Complementar Federal nº 194",
 * "1. Redação do inciso IX sem efeitos de 23.06.22 a 29.04.23 …"). Vem em parágrafo editorial
 * (`NotaDisc*`) ou, por erro da fonte, em `TextoRevo`, sempre depois da redação que ela atinge.
 */
export interface WithoutEffectNote {
  /** Rótulo citado, dobrado e sem aspas ("inciso viii", "alinea a", "item 1"). */
  readonly label: string
  /** Primeiro dia sem efeitos; `null` quando a data não foi lida (vai para revisão). */
  readonly from: IsoDate | null
  /** Último dia sem efeitos (inclusivo) quando a nota fecha o período; `null` = em diante. */
  readonly until: IsoDate | null
}

const MONTHS: Readonly<Record<string, number>> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
}

/** Data numérica ("23.06.22") ou por extenso ("23 de junho de 2022", "1º de janeiro de 2024"). */
const ANY_DATE = new RegExp(
  `^(?:${DATE_TOKEN}|(\\d{1,2})\\s?[º°o]?\\s+de\\s+([a-z]+)\\s+de\\s+(\\d{4}))`,
)

function leadingDate(text: string, pivot: number): { date: IsoDate | null; end: number } | null {
  const match = ANY_DATE.exec(text)
  if (match === null) {
    return null
  }
  const [whole, day, month, year, longDay, monthName = '', longYear] = match
  if (day !== undefined) {
    return { date: dateFromParts(day, month ?? '', year ?? '', pivot), end: whole.length }
  }
  const monthNumber = MONTHS[monthName]
  return {
    date:
      monthNumber === undefined
        ? null
        : dateFromParts(longDay ?? '', String(monthNumber), longYear ?? '', pivot),
    end: whole.length,
  }
}

const WITHOUT_EFFECT = /^redac\S*\s+(?:d[aoe]s?\s+)?(.+?)\s+sem\s+efeitos?\s+(.*)$/

/**
 * Lê uma nota "Redação d… <rótulo> sem efeitos a partir de <data>" (ou "desde <data>", ou "de
 * <data> a <data>"); `null` se o parágrafo não é desse tipo. Datas ilegíveis voltam `from: null`.
 */
export function parseWithoutEffectNote(raw: string, pivot: number): WithoutEffectNote | null {
  const body = foldNote(raw).replace(NOTE_PREFIX, '')
  const match = WITHOUT_EFFECT.exec(body)
  if (match === null) {
    return null
  }
  const label = (match[1] ?? '').replace(/["“”'‘’]/g, '').trim()
  const rest = match[2] ?? ''
  const opening = /^(a partir de|desde|de)\s+/.exec(rest)
  const first = opening === null ? null : leadingDate(rest.slice(opening[0].length), pivot)
  if (opening === null || first === null || first.date === null) {
    return { label, from: null, until: null }
  }
  if (opening[1] !== 'de') {
    return { label, from: first.date, until: null }
  }
  // "de a a b": só com as duas datas legíveis.
  const afterFirst = rest.slice(opening[0].length + first.end)
  const joiner = /^\s*(?:a|ate|-)\s+/.exec(afterFirst)
  const second = joiner === null ? null : leadingDate(afterFirst.slice(joiner[0].length), pivot)
  if (second?.date == null || second.date < first.date) {
    return { label, from: null, until: null }
  }
  return { label, from: first.date, until: second.date }
}

// ---------------------------------------------------------------------------------------------
// Atos alteradores

export interface ActReference {
  /** Ex.: "Decreto nº 6.026, de 27.10.04"; sem a data quando a nota não a traz. */
  readonly label: string
  /** "decreto", "lei", "lei-complementar", "convenio", "ajuste", "instrucao-normativa". */
  readonly kind: string
  readonly date: IsoDate | null
}

const ACT_KINDS: readonly (readonly [RegExp, string, string])[] = [
  [/^lei complementar/, 'lei-complementar', 'Lei Complementar'],
  [/^lei/, 'lei', 'Lei'],
  [/^decreto/, 'decreto', 'Decreto'],
  [/^convenio/, 'convenio', 'Convênio ICMS'],
  [/^ajuste/, 'ajuste', 'Ajuste SINIEF'],
  [/^instrucao/, 'instrucao-normativa', 'Instrução Normativa'],
]

const ACT_PATTERN = new RegExp(
  String.raw`\b(lei complementar|lei|decreto|convenio(?: icms)?|ajuste(?: sinief)?|instrucao normativa)\s*(?:n\s?[º°o.]?\s*)?(\d[\d.]*(?:\/\d{2,4})?)(?:\s*,?\s*de\s+${DATE_TOKEN})?`,
)

/** Primeiro ato citado na nota (o alterador); `null` se não houver número de ato. */
export function parseActReference(raw: string, pivot: number): ActReference | null {
  const folded = foldNote(raw)
  const match = ACT_PATTERN.exec(folded)
  if (match === null) {
    return null
  }
  const [, kindText = '', number = ''] = match
  const [, kind, title] = ACT_KINDS.find(([pattern]) => pattern.test(kindText)) ?? [
    null,
    kindText,
    kindText,
  ]
  const hasDate = match[3] !== undefined
  const date = hasDate ? dateFromParts(match[3] ?? '', match[4] ?? '', match[5] ?? '', pivot) : null
  const dateText = hasDate
    ? `${(match[3] ?? '').padStart(2, '0')}.${(match[4] ?? '').padStart(2, '0')}.${match[5] ?? ''}`
    : null
  // O ano no número ("6.057/04") sai do rótulo, como na fixture da F2.
  const cleanNumber = number.replace(/\/\d{2,4}$/, '').replace(/\.$/, '')
  return {
    label:
      dateText === null
        ? `${title} nº ${cleanNumber}`
        : `${title} nº ${cleanNumber}, de ${dateText}`,
    kind,
    date,
  }
}

/** Leitura de uma nota de alteração (`NovaRedao`, `NovaRedRev`). */
export interface AmendmentNote {
  readonly rawNote: string
  /** `null` quando o tipo de alteração não foi reconhecido. */
  readonly changeKind: ChangeKind | null
  readonly act: ActReference | null
  /** Data de efeito ("vigência: dd.mm.aa"); `null` se ausente ou ilegível. */
  readonly effectiveFrom: IsoDate | null
  /** Último dia de vigência declarado na própria nota ("vigência: a A b", prorrogação). */
  readonly until: IsoDate | null
  /** "EXAURIU-SE EM FUNÇÃO DO DECURSO DO PRAZO": o dispositivo deixou de valer, sem data. */
  readonly exhausted: boolean
  /** "Nova redação ao caput": os filhos não herdam a abertura. */
  readonly caputOnly: boolean
  /** Rótulo anterior numa renumeração ("paragrafo unico", "inciso xvi"), já dobrado. */
  readonly renumberedFrom: string | null
  /** Dispositivos que a nota cita como alterados (sem os do ato alterador). */
  readonly cited: readonly CitedLabel[]
}

// ---------------------------------------------------------------------------------------------
// Dispositivos citados na nota de alteração

/**
 * Dispositivo citado por uma nota de alteração ("ao INCISO IV do art. 12"), com o valor no formato
 * do segmento da chave estável (`12-A`, `3-A`, `unico`, `IV-A`, `a`, `2-1`).
 */
export interface CitedLabel {
  readonly kind: 'art' | 'par' | 'inc' | 'ali' | 'item'
  readonly value: string
}

/**
 * O ato alterador e os dispositivos dele ("pelo art. 1º do Decreto nº 10.611, de 18.12.24", "POR
 * FORÇA DO ART. 2º DO DECRETO Nº 7.344", "pelo inciso I do art. 1º da Lei nº …"): sai do texto antes
 * da leitura dos citados.
 */
const ACT_CITATION = new RegExp(
  String.raw`(?:\b(?:pel[oa]s?|por(?: forca)?(?: d[oa]s?)?|conforme|nos termos d[oa]s?|de acordo com)\s+` +
    String.raw`(?:(?:o |a )?(?:art\.?|artigo|inciso|§|paragrafo|alinea|item)\s*\S+?,?\s+(?:d[oa]s?\s+)?)*)?` +
    String.raw`\b(?:lei complementar|lei|decreto|convenio|ajuste|instrucao normativa|resolucao|protocolo|emenda constitucional|lc)\b[^,;()]*?\d[\d./]*(?:\s*,?\s*de\s+\d[\d.]*)?`,
  'g',
)

/** Separadores de lista ("e", ",") e de intervalo ("a", "até") entre dois rótulos. */
const LIST_JOINER = /^\s*(,|(?:ate|e|a)(?=\s))\s*/
/** Depois de "e"/"a", "o"/"a" seguido de outro rótulo é artigo, não alínea ("e o inciso"). */
const NEXT_LABEL =
  /^["“”'‘’]?\s+(?:incisos?|alineas?|itens|item|§|paragrafos?|arts?\b|artigos?|caput)/

interface LabelGrammar {
  readonly kind: CitedLabel['kind']
  /** Palavra-chave do rótulo, até o primeiro valor. */
  readonly keyword: RegExp
  /** Um valor, ancorado no início. */
  readonly value: RegExp
  readonly build: (match: RegExpExecArray) => string | null
  /** Posição numérica para expandir intervalos ("incisos IV a VI"). */
  readonly ordinal: (value: string) => number | null
}

const ROMAN_NUMERAL = /^M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/

/** Valor de um numeral romano já validado (`ROMAN_NUMERAL`, só I, V, X, L e C nos incisos). */
function romanValue(roman: string): number {
  const digits: Readonly<Record<string, number>> = { I: 1, V: 5, X: 10, L: 50, C: 100 }
  const values = [...roman].map((symbol) => digits[symbol] ?? 0)
  return values.reduce(
    (total, value, index) => total + (value < (values[index + 1] ?? 0) ? -value : value),
    0,
  )
}

function toRoman(value: number): string {
  const table: readonly (readonly [number, string])[] = [
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ]
  let rest = value
  let roman = ''
  for (const [amount, symbol] of table) {
    while (rest >= amount) {
      roman += symbol
      rest -= amount
    }
  }
  return roman
}

/** "167 - s - b" → "167-s-b". */
const compactLabel = (label: string): string => label.replace(/\s/g, '')

/** Só valores sem sufixo entram num intervalo; o resto vale como está. */
const plainNumber = (value: string): number | null => (/^\d+$/.test(value) ? Number(value) : null)

const LABEL_GRAMMARS: readonly LabelGrammar[] = [
  {
    kind: 'art',
    keyword: /\b(?:arts?\.?|artigos?)\s*/g,
    value: /^(\d{1,4})\s?(?:[º°]|o(?![a-z]))?((?:\s?-\s?[a-z](?![a-z]))*)/,
    // Os grupos de sufixo casam sempre (vazios quando não há sufixo): "167" + "-s-b".
    build: (m) => compactLabel(`${m[1]}${m[2]}`).toUpperCase(),
    ordinal: plainNumber,
  },
  {
    kind: 'par',
    keyword: /§§?\s*|\bparagrafos?\s+/g,
    value: /^(?:unico|0?(\d{1,2})\s?(?:[º°]|o(?![a-z]))?((?:\s?-\s?[a-z](?![a-z]))?))/,
    build: (m) => (m[0] === 'unico' ? 'unico' : compactLabel(`${m[1]}${m[2]}`).toUpperCase()),
    ordinal: plainNumber,
  },
  {
    kind: 'inc',
    keyword: /\bincisos?\s+/g,
    value: /^([ivxlc]{1,8})(?![a-z])((?:\s?-\s?[a-z](?![a-z]))?)/,
    build: (m) => {
      const label = compactLabel(`${m[1]}${m[2]}`).toUpperCase()
      return ROMAN_NUMERAL.test(label.replace(/-.*/, '')) ? label : null
    },
    ordinal: (value) => (/^[IVXLC]+$/.test(value) ? romanValue(value) : null),
  },
  {
    kind: 'ali',
    keyword: /\balineas?\s+/g,
    value: /^["“”'‘’]?([a-z])((?:\s?-\s?0?\d{1,2})?)["“”'‘’]?(?![a-z\d])/,
    build: (m) => compactLabel(`${m[1]}${m[2]}`).replace(/-0(?=\d)/, '-'),
    ordinal: (value) => (/^[a-z]$/.test(value) ? value.charCodeAt(0) : null),
  },
  {
    kind: 'item',
    keyword: /\b(?:itens|item)\s+/g,
    value: /^(\d{1,3})(?:\s?-\s?([a-z]|\d{1,3}))?(?![\d.]*\.\d)(?![a-z\d])/,
    build: (m) => {
      const head = String(Number(m[1]))
      const suffix = m[2]
      if (suffix === undefined) {
        return head
      }
      return `${head}-${/\d/.test(suffix) ? String(Number(suffix)) : String(suffix.charCodeAt(0) - 96)}`
    },
    ordinal: plainNumber,
  },
]

function valueFromOrdinal(kind: CitedLabel['kind'], ordinal: number): string {
  if (kind === 'inc') {
    return toRoman(ordinal)
  }
  return kind === 'ali' ? String.fromCharCode(ordinal) : String(ordinal)
}

/** Intervalo "IV a VI" → V (os extremos já entraram); limitado para não explodir com erro da fonte. */
function rangeBetween(grammar: LabelGrammar, first: string, last: string): string[] {
  const from = grammar.ordinal(first)
  const to = grammar.ordinal(last)
  if (from === null || to === null || to <= from || to - from > 30) {
    return []
  }
  const values: string[] = []
  for (let ordinal = from + 1; ordinal < to; ordinal += 1) {
    values.push(valueFromOrdinal(grammar.kind, ordinal))
  }
  return values
}

/** Lista de valores depois da palavra-chave: "IV", "IV e V", "IV a VI", "“a” e “b”". */
function readLabelList(grammar: LabelGrammar, text: string): string[] {
  const values: string[] = []
  let rest = text
  /** Separador antes do valor corrente (`null` no primeiro). */
  let joiner: string | null = null
  for (;;) {
    const match = grammar.value.exec(rest)
    const value = match === null ? null : grammar.build(match)
    if (match === null || value === null) {
      return values
    }
    const after = rest.slice(match[0].length)
    // "PARÁGRAFO ÚNICO ATÉ 04.04.22": depois de "até" vem data, não rótulo.
    if (joiner !== null && (NEXT_LABEL.test(after) || after.startsWith('.'))) {
      return values
    }
    const previous = values.at(-1)
    if (previous !== undefined && (joiner === 'a' || joiner === 'ate')) {
      values.push(...rangeBetween(grammar, previous, value))
    }
    values.push(value)
    const next = LIST_JOINER.exec(after)
    if (next === null) {
      return values
    }
    joiner = String(next[1])
    rest = after.slice(next[0].length)
  }
}

/**
 * Dispositivos citados pela nota de alteração, sem o ato alterador: "Conferida nova redação ao
 * INCISO IV do art. 12 pelo art. 1º do Decreto nº 10.611" → inciso IV e art. 12; "ACRESCIDAS AS
 * ALÍNEAS "A" E "B" AO INCISO V" → alíneas a e b e inciso V; "incisos IV a VI" → IV, V e VI. Sem
 * citação legível, a lista sai vazia.
 */
export function parseCitedLabels(raw: string): CitedLabel[] {
  // "ART. 57pelo art. 10", "ART. 167-JPELO": o "pelo" grudado no rótulo.
  const folded = foldNote(raw).replace(/(\d|-[a-z])(pel[oa]s?\s)/g, '$1 $2')
  // Depois do primeiro "pelo" vem o ato ("PELO ART. 1º, I, DA LEI", "PELOS ARTS. 3º E 1º DO
  // DECRETO"); o que sobra de ato antes dele ("POR FORÇA DO ART. 2º DO DECRETO") sai pelo padrão.
  const byAct = /\bpel[oa]s?\b/.exec(folded)
  const text = (byAct === null ? folded : folded.slice(0, byAct.index)).replace(ACT_CITATION, ' ')
  const cited: CitedLabel[] = []
  for (const grammar of LABEL_GRAMMARS) {
    const keyword = new RegExp(grammar.keyword.source, 'g')
    for (let match = keyword.exec(text); match !== null; match = keyword.exec(text)) {
      for (const value of readLabelList(grammar, text.slice(match.index + match[0].length))) {
        if (!cited.some((label) => label.kind === grammar.kind && label.value === value)) {
          cited.push({ kind: grammar.kind, value })
        }
      }
    }
  }
  return cited
}

const LABEL_PHRASE = String.raw`(paragrafo unico|§ ?unico|§ ?\d{1,2} ?[º°o]?(?: ?- ?[a-z])?|inciso [ivxlc]{1,8}(?: ?- ?[a-z])?|alinea "?[a-z]"?)`

function renumberedFromOf(folded: string): string | null {
  const patterns = [
    new RegExp(`vigorou como ${LABEL_PHRASE}`),
    new RegExp(
      `renumerad[oa]s?,?(?: com nova redacao,?)? (?:tacitamente )?(?:para [^,]*? )?(?:o |a )?${LABEL_PHRASE}`,
    ),
    new RegExp(`(?:o|a) ${LABEL_PHRASE}[^.]{0,40}? foi renumerad`),
    new RegExp(`renumerad[oa] para [^ ]+ (?:[^ ]+ )?(?:o |a )${LABEL_PHRASE}`),
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(folded)
    if (match?.[1] !== undefined) {
      return match[1].replace(/\s+/g, ' ')
    }
  }
  return null
}

function changeKindOf(folded: string): ChangeKind | null {
  if (/renumerad/.test(folded)) {
    return /nova (?:nova )?redacao|alterad/.test(folded)
      ? ChangeKind.NovaRedacao
      : ChangeKind.Renumeracao
  }
  if (/revogad/.test(folded)) {
    return ChangeKind.Revogacao
  }
  if (/acrescid|acrecid/.test(folded)) {
    return ChangeKind.Acrescimo
  }
  if (/nova redacao|redacao conferida|revigorad|alterad/.test(folded)) {
    return ChangeKind.NovaRedacao
  }
  if (/prorrogad/.test(folded)) {
    return ChangeKind.Prorrogacao
  }
  return null
}

/** Lê uma nota de alteração (abertura de uma redação). */
export function parseAmendmentNote(raw: string, pivot: number): AmendmentNote {
  const folded = foldNote(raw)
  const exhausted = /exauriu-?\s?se/.test(folded)
  const renumberedFrom = renumberedFromOf(folded)
  const base = {
    rawNote: raw.replace(/\s+/g, ' ').trim(),
    act: parseActReference(raw, pivot),
    exhausted,
    caputOnly: /(?:redacao|alterad[oa]) (?:ao|o|a) caput\b/.test(folded),
    renumberedFrom,
    cited: parseCitedLabels(raw),
  }
  if (exhausted) {
    return { ...base, changeKind: ChangeKind.Revogacao, effectiveFrom: null, until: null }
  }
  return { ...base, changeKind: changeKindOf(folded), ...effectiveDatesOf(folded, pivot) }
}

function effectiveDatesOf(
  folded: string,
  pivot: number,
): { readonly effectiveFrom: IsoDate | null; readonly until: IsoDate | null } {
  const until = /prorrogad[ao]\s+(?:para|ate)\s+/.exec(folded)
  const extendedTo =
    until === null ? null : (findDates(folded, pivot, until.index)[0]?.date ?? null)
  const vigorou = /vigorou como [^,]*? ate (?:o dia )?/.exec(folded)
  if (vigorou !== null) {
    const lastAsOld = findDates(folded, pivot, vigorou.index)[0]?.date ?? null
    const vig = new RegExp(`${VIG}\\s*:?\\s*${DATE_TOKEN}`).exec(folded)
    const effective = vig === null ? null : (findDates(folded, pivot, vig.index)[0]?.date ?? null)
    return {
      effectiveFrom: effective ?? (lastAsOld === null ? null : addDays(lastAsOld, 1)),
      until: extendedTo,
    }
  }
  const vig = new RegExp(`${VIG}\\s*(?::|a partir de|de)?\\s*-?\\s*${DATE_TOKEN}`).exec(folded)
  if (vig === null) {
    return { effectiveFrom: null, until: extendedTo }
  }
  const [first, second] = findDates(folded, pivot, vig.index)
  const between =
    first !== undefined && second !== undefined ? folded.slice(first.end, second.index) : ''
  const declaredUntil = /^\s*(?:a|ate)\s*$/.test(between) ? (second?.date ?? null) : null
  return { effectiveFrom: first?.date ?? null, until: extendedTo ?? declaredUntil }
}

// ---------------------------------------------------------------------------------------------
// Notas inline: "(Redação acrescida pelo Decreto nº 8.068 - vigência: 30.12.13)"

export interface InlineNote {
  readonly rawNote: string
  readonly changeKind: ChangeKind | null
  readonly act: ActReference | null
  readonly first: IsoDate | null
  readonly last: IsoDate | null
  readonly withoutValidity: boolean
  readonly renumberedFrom: string | null
  /** A nota foi reconhecida como de vigência, mas as datas não: vai para revisão. */
  readonly unparsed: boolean
}

const INLINE_TAIL = /\(([^()]*)\)[\s.;:,]*$/u
const INLINE_HEAD = /^(?:redac|acresc|acrec|revog|renum|revig|o ?§|o paragrafo)/

/**
 * Separa a nota inline (o último parêntese do parágrafo, quando é uma nota de vigência) do texto
 * do dispositivo. Devolve o texto sem a nota e a nota lida, ou `note: null`.
 */
export function extractInlineNote(
  text: string,
  pivot: number,
): { readonly text: string; readonly note: InlineNote | null } {
  const match = INLINE_TAIL.exec(text)
  const inner = match?.[1]
  if (match === null || inner === undefined) {
    return { text, note: null }
  }
  const folded = foldNote(inner)
  if (!INLINE_HEAD.test(folded) || !/vig/.test(folded)) {
    return { text, note: null }
  }
  return { text: text.slice(0, match.index).trimEnd(), note: parseInlineBody(inner, folded, pivot) }
}

/** O que pode separar as duas datas de uma nota ("de X a Y", "X até Y", "X - Y"), já sem acento. */
const RANGE_JOINERS: ReadonlySet<string> = new Set(['', 'a', 'ate', 'a a', '-'])

function parseInlineBody(inner: string, folded: string, pivot: number): InlineNote {
  const rawNote = `(${inner.replace(/\s+/g, ' ').trim()})`
  const base = {
    rawNote,
    act: parseActReference(inner, pivot),
    renumberedFrom: renumberedFromOf(folded),
    changeKind: /^redac\S* original/.test(folded) ? ChangeKind.Original : changeKindOf(folded),
  }
  if (new RegExp(`sem\\s*-?\\s*${VIG}`).test(folded)) {
    return { ...base, first: null, last: null, withoutValidity: true, unparsed: false }
  }
  const vigorou = /vigorou como [^()]*? (?:de (\S+) )?(?:a|ate) (\S+?),? quando/.exec(folded)
  if (vigorou !== null) {
    const [, , lastToken = ''] = vigorou
    const lastAsOld = parseNoteDate(lastToken, pivot)
    return {
      ...base,
      first: lastAsOld === null ? null : addDays(lastAsOld, 1),
      last: null,
      withoutValidity: false,
      unparsed: lastAsOld === null,
    }
  }
  const vig = new RegExp(`${VIG}`).exec(folded)
  const hits = vig === null ? [] : findDates(folded, pivot, vig.index)
  const [first, second] = hits
  const between =
    first !== undefined && second !== undefined ? folded.slice(first.end, second.index) : ''
  const twoDates = second !== undefined && RANGE_JOINERS.has(between.trim())
  const unparsed =
    first?.date == null ||
    (twoDates && second?.date == null) ||
    hits.length > 2 ||
    (second !== undefined && !twoDates)
  return {
    ...base,
    first: first?.date ?? null,
    last: twoDates ? (second?.date ?? null) : null,
    withoutValidity: false,
    unparsed,
  }
}

// ---------------------------------------------------------------------------------------------
// Linha do tempo de um dispositivo

/** Códigos de revisão (`ReviewFlag.reason`), estáveis porque entram na chave dos overrides. */
export const ReviewReason = {
  NoteUnparsed: 'note-unparsed',
  NoteDateIllegible: 'note-date-illegible',
  NoteAmbiguous: 'note-ambiguous',
  NoteOrphan: 'note-orphan',
  InlineUnparsed: 'inline-unparsed',
  OpeningMismatch: 'opening-mismatch',
  OpeningMissing: 'opening-missing',
  EndInferred: 'end-inferred',
  EndMissing: 'end-missing',
  StyleMismatch: 'style-mismatch',
  ExhaustedAmbiguous: 'exhausted-ambiguous',
  IntervalInverted: 'interval-inverted',
  DuplicateCurrent: 'duplicate-current',
  Overlap: 'overlap',
  BeforeParent: 'before-parent',
  BeforeRestructuring: 'before-restructuring',
  RenumberingUnresolved: 'renumbering-unresolved',
} as const
export type ReviewReason = (typeof ReviewReason)[keyof typeof ReviewReason]

/** Motivos de descarte (vão para `skipped`, só log). */
export const SkipReason = {
  WithoutValidity: 'sem-vigencia',
  ClippedAtRestructuring: 'antes-da-reestruturacao',
} as const
export type SkipReason = (typeof SkipReason)[keyof typeof SkipReason]

export interface ReviewMark {
  readonly reason: ReviewReason
  readonly rawNote: string | null
}

/**
 * Uma redação de um dispositivo, como o parser a encontrou (ordem do documento). Os campos de
 * data são as evidências; `resolveTimeline` escolhe entre elas.
 */
export interface VersionCandidate {
  readonly text: string
  /** `TextoRevo` (redação superada) ou vigente (`ParNormal`). */
  readonly superseded: boolean
  /** Abertura dada pelo ato alterador (`NovaRedao`/`NovaRedRev`), própria ou herdada do pai. */
  readonly amendmentFrom: IsoDate | null
  /** `true` quando a nota de alteração é do próprio dispositivo (não herdada). */
  readonly amendmentOwn: boolean
  /** Último dia declarado pela própria nota de alteração (inclusivo). */
  readonly amendmentUntil: IsoDate | null
  readonly exhausted: boolean
  readonly inlineFirst: IsoDate | null
  readonly inlineLast: IsoDate | null
  /** Período da `NotaVigncia` que fechou a redação (inclusivo). */
  readonly noteFirst: IsoDate | null
  readonly noteLast: IsoDate | null
  /** "Sem vigência" (nota ou inline): intervalo vazio. */
  readonly withoutValidity: boolean
  /** Intervalo da redação superada do pai, para filhos sem nota própria ("bloco do pai"). */
  readonly parentBlock: ValidityInterval | null
  /**
   * Nota "sem efeitos" que atinge esta redação: `[from, until + 1)` sai do intervalo (com `until:
   * null`, a redação termina em `from`).
   */
  readonly withoutEffect: {
    readonly from: IsoDate
    readonly until: IsoDate | null
    readonly rawNote: string
  } | null
  /** Anomalias já percebidas pelo parser (estilo, nota ilegível etc.). */
  readonly marks: readonly ReviewMark[]
}

interface ResolvedVersion {
  /** Índice do candidato de origem (ordem do documento). */
  readonly index: number
  readonly validDuring: ValidityInterval
  readonly review: ReviewMark | null
}

interface SkippedCandidate {
  readonly index: number
  readonly reason: SkipReason
}

/** Intervalo com início (toda redação começa em algum dia). */
type BoundedInterval = { readonly from: IsoDate; readonly to: IsoDate | null }

export interface TimelineContext {
  /** Início da redação original (RCTE: 1998-01-01; CTE: 1992-03-01). */
  readonly originalFrom: IsoDate
}

export interface Timeline {
  readonly versions: readonly ResolvedVersion[]
  readonly skipped: readonly SkippedCandidate[]
}

function explicitFrom(candidate: VersionCandidate, marks: ReviewMark[]): IsoDate | null {
  const { noteFirst, inlineFirst, amendmentFrom, amendmentOwn } = candidate
  const declared = noteFirst ?? inlineFirst
  // Com estilo incoerente, a nota de alteração pode ser de outro dispositivo: vale a nota de
  // vigência (a versão já vai para revisão pela marca de estilo).
  const styleMismatch = candidate.marks.some((mark) => mark.reason === ReviewReason.StyleMismatch)
  if (
    declared !== null &&
    amendmentFrom !== null &&
    declared !== amendmentFrom &&
    amendmentOwn &&
    !styleMismatch
  ) {
    // A abertura do ato próprio vale (a nota costuma errar por um dia), mas fica para revisão.
    marks.push({ reason: ReviewReason.OpeningMismatch, rawNote: null })
    return amendmentFrom
  }
  if (noteFirst !== null && inlineFirst !== null && noteFirst !== inlineFirst) {
    marks.push({ reason: ReviewReason.OpeningMismatch, rawNote: null })
  }
  return declared ?? amendmentFrom ?? null
}

function explicitTo(candidate: VersionCandidate): IsoDate | null | undefined {
  const last = candidate.noteLast ?? candidate.inlineLast ?? candidate.amendmentUntil
  if (last !== null) {
    return addDays(last, 1)
  }
  if (candidate.superseded && candidate.parentBlock !== null) {
    return candidate.parentBlock.to
  }
  return undefined
}

function boundedInterval(
  from: IsoDate,
  to: IsoDate | null,
  marks: ReviewMark[],
): { readonly from: IsoDate; readonly to: IsoDate | null } {
  if (to === null || from < to) {
    return Object.freeze({ from, to })
  }
  marks.push({ reason: ReviewReason.IntervalInverted, rawNote: null })
  return Object.freeze(to < from ? { from: to, to: from } : { from, to: addDays(from, 1) })
}

/**
 * Monta a linha do tempo de um dispositivo a partir das redações na ordem do documento:
 *
 * - início: nota de vigência > nota inline > ato alterador > bloco do pai; sem nenhum, a
 *   original (primeira redação) ou o fim da redação anterior (com revisão, exceto "EXAURIU-SE");
 * - fim: nota > inline > fim declarado no ato > bloco do pai; vigente sem fim = `null`; superada
 *   sem fim = início da redação seguinte (com revisão, exceto quando a nota inline trouxe só o
 *   início, caso previsto no plano);
 * - "sem vigência" vai para `skipped`; mais de uma redação vigente, revisão nas anteriores;
 * - "sem efeitos a partir de a" termina a redação em `a`; "sem efeitos de a a b" tira `[a, b + 1)`
 *   do intervalo, que pode virar duas versões com o mesmo texto.
 */
export function resolveTimeline(
  rawCandidates: readonly VersionCandidate[],
  context: TimelineContext,
): Timeline {
  const rawStarts = rawCandidates.map((candidate) => explicitFrom(candidate, []))
  const candidates = rawCandidates.map((candidate, index) =>
    spansEarlierVersions(candidate, rawStarts.slice(0, index))
      ? { ...candidate, noteFirst: null }
      : candidate,
  )
  const starts = candidates.map((candidate) => explicitFrom(candidate, []))
  const lastCurrent = candidates.findLastIndex((candidate) => !candidate.superseded)
  const versions: ResolvedVersion[] = []
  const skipped: SkippedCandidate[] = []
  let previous: BoundedInterval | null = null
  candidates.forEach((candidate, index) => {
    const marks: ReviewMark[] = [...candidate.marks]
    explicitFrom(candidate, marks)
    if (
      candidate.withoutValidity ||
      (isEmptyNote(candidate) && (previous === null || starts[index + 1] === candidate.noteFirst))
    ) {
      skipped.push({ index, reason: SkipReason.WithoutValidity })
      return
    }
    const from = startOf(candidate, index, starts[index] ?? null, previous, context, marks)
    const to = endOf(candidate, starts[index + 1], marks)
    if (!candidate.superseded && index !== lastCurrent) {
      marks.push({ reason: ReviewReason.DuplicateCurrent, rawNote: null })
    }
    const pieces = withoutEffectPieces(boundedInterval(from, to, marks), candidate, marks)
    previous = pieces.at(-1) ?? null
    for (const validDuring of pieces) {
      versions.push({ index, validDuring, review: marks[0] ?? null })
    }
  })
  return { versions, skipped }
}

/**
 * Nota "de a a a − 1" ("Redação com vigência de 01.05.23 a 30.04.23"): a redação não chegou a
 * vigorar. Só vale como "sem vigência" quando não abre lacuna (ver `resolveTimeline`).
 */
function isEmptyNote(candidate: VersionCandidate): boolean {
  return (
    candidate.noteFirst !== null &&
    candidate.noteLast !== null &&
    addDays(candidate.noteLast, 1) === candidate.noteFirst
  )
}

/**
 * A nota de vigência conta a história do dispositivo, e não só desta redação: o início dela é o
 * de uma redação anterior do mesmo dispositivo, e a redação tem início próprio na nota inline
 * ("IV - … (Redação conferida pelo Decreto nº 9.015 - vigência: 22.11.16)" seguido de "NOTA:
 * Redação com vigência de 01.01.01 a 17.11.22", com a redação de 01.01.01 logo acima). Vale o
 * início da nota inline; o fim continua o da nota.
 */
function spansEarlierVersions(
  candidate: VersionCandidate,
  earlierStarts: readonly (IsoDate | null)[],
): boolean {
  const { noteFirst, inlineFirst } = candidate
  return (
    noteFirst !== null &&
    inlineFirst !== null &&
    noteFirst !== inlineFirst &&
    noteFirst < inlineFirst &&
    !candidate.amendmentOwn &&
    earlierStarts.includes(noteFirst)
  )
}

/**
 * Tira do intervalo o período "sem efeitos": `[from, until + 1)`, ou `[from, ∞)` sem `until`. Um
 * período no meio parte a redação em duas (mesmo texto, sem a lacuna). Se nada sobra (a redação
 * começou depois de perder o efeito), o intervalo fica e vai para revisão.
 */
function withoutEffectPieces(
  interval: BoundedInterval,
  candidate: VersionCandidate,
  marks: ReviewMark[],
): BoundedInterval[] {
  const cut = candidate.withoutEffect
  if (cut === null) {
    return [interval]
  }
  const gap = { from: cut.from, to: cut.until === null ? null : addDays(cut.until, 1) }
  // Partes de um intervalo com início: todas têm início.
  const pieces = subtractIntervals([interval], [gap]).filter(
    (piece): piece is BoundedInterval => piece.from !== null,
  )
  if (pieces.length === 0) {
    marks.push({ reason: ReviewReason.NoteAmbiguous, rawNote: cut.rawNote })
    return [interval]
  }
  return pieces
}

function startOf(
  candidate: VersionCandidate,
  index: number,
  declared: IsoDate | null,
  previous: { readonly from: IsoDate; readonly to: IsoDate | null } | null,
  context: TimelineContext,
  marks: ReviewMark[],
): IsoDate {
  if (declared !== null) {
    return declared
  }
  if (candidate.exhausted) {
    if (previous?.to != null) {
      return previous.to
    }
    marks.push({ reason: ReviewReason.ExhaustedAmbiguous, rawNote: null })
    return previous?.from ?? context.originalFrom
  }
  if (index === 0 || previous === null) {
    // Primeira redação: o bloco do pai (filho de redação superada) ou a original.
    return candidate.parentBlock?.from ?? context.originalFrom
  }
  marks.push({ reason: ReviewReason.OpeningMissing, rawNote: null })
  return previous.to ?? previous.from
}

function endOf(
  candidate: VersionCandidate,
  nextStart: IsoDate | null | undefined,
  marks: ReviewMark[],
): IsoDate | null {
  const declared = explicitTo(candidate)
  if (declared !== undefined) {
    return declared
  }
  // Sem fim declarado, a nota "sem efeitos a partir de" é o fim (o corte vem depois, em
  // `withoutEffectPieces`): nada a inferir da redação seguinte.
  if (
    !candidate.superseded ||
    (candidate.withoutEffect !== null && candidate.withoutEffect.until === null)
  ) {
    return null
  }
  if (nextStart != null) {
    if (candidate.inlineFirst === null) {
      marks.push({ reason: ReviewReason.EndInferred, rawNote: null })
    }
    return nextStart
  }
  marks.push({ reason: ReviewReason.EndMissing, rawNote: null })
  return null
}

// ---------------------------------------------------------------------------------------------
// Pós-processamento das versões de um dispositivo

/** O mínimo que as regras abaixo precisam saber de uma versão. */
export interface TimedText {
  readonly validDuring: ValidityInterval
  readonly text: string
  readonly review: ReviewMark | null
}

/**
 * Funde redações consecutivas (adjacentes no tempo) com o mesmo texto canônico
 * (`normalizeForHash`, a base do `content_hash`) numa só, com o intervalo alargado. Só funde
 * versões sem revisão; a primeira de cada grupo fica (com a nota de alteração dela).
 */
export function mergeIdenticalConsecutive<T extends TimedText>(versions: readonly T[]): T[] {
  const sorted = [...versions].sort((a, b) => compareIntervals(a.validDuring, b.validDuring))
  const merged: T[] = []
  for (const current of sorted) {
    const last = merged.at(-1)
    if (
      last !== undefined &&
      last.review === null &&
      current.review === null &&
      last.validDuring.to !== null &&
      last.validDuring.to === current.validDuring.from &&
      normalizeForHash(last.text) === normalizeForHash(current.text)
    ) {
      merged[merged.length - 1] = {
        ...last,
        validDuring: Object.freeze({ from: last.validDuring.from, to: current.validDuring.to }),
      }
    } else {
      merged.push(current)
    }
  }
  return merged
}

/**
 * Garante que as versões publicáveis (sem revisão) de um dispositivo não se sobrepõem: na ordem
 * do início, a que cruza uma anterior vai para revisão (`overlap`). As demais seguem publicáveis,
 * como o `pv_no_overlap`, que ignora as pendentes.
 */
export function flagOverlaps<T extends TimedText>(versions: readonly T[]): T[] {
  const sorted = [...versions].sort((a, b) => compareIntervals(a.validDuring, b.validDuring))
  const accepted: ValidityInterval[] = []
  return sorted.map((version) => {
    if (version.review !== null) {
      return version
    }
    if (accepted.some((interval) => overlaps(interval, version.validDuring))) {
      return { ...version, review: { reason: ReviewReason.Overlap, rawNote: null } }
    }
    accepted.push(version.validDuring)
    return version
  })
}

/**
 * Reestruturação da norma (CTE em 1997-01-01: números de artigo trocaram de conteúdo). Redações
 * que terminam até a data vão para revisão; as que a atravessam começam nela (o trecho anterior
 * fica no log), como na fixture da F2. As posteriores não mudam.
 */
export function applyRestructuringCut<T extends TimedText>(
  versions: readonly T[],
  cut: IsoDate,
): { readonly versions: T[]; readonly clipped: readonly T[] } {
  const clipped: T[] = []
  const result = versions.map((version) => {
    const { from, to } = version.validDuring
    if (to !== null && to <= cut) {
      return version.review === null
        ? { ...version, review: { reason: ReviewReason.BeforeRestructuring, rawNote: null } }
        : version
    }
    if (from !== null && from < cut) {
      clipped.push(version)
      return { ...version, validDuring: Object.freeze({ from: cut, to }) }
    }
    return version
  })
  return { versions: result, clipped }
}
