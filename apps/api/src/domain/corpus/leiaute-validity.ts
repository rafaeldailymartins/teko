import {
  addDays,
  createInterval,
  fromCalendarDate,
  type IsoDate,
  isIsoDate,
  isNonEmptyInterval,
  overlaps,
  type ValidityInterval,
} from '@teko/shared/vigencia'
import { Modality } from './family.ts'
import type { ReviewFlag } from './parsed-source.ts'

/**
 * Regras de vigência das fontes por leiaute e por publicação (plano, "Regras de vigência", itens
 * 1, 2, 4 e 5): Guia Prático EFD ICMS/IPI, leiautes da EFD-REINF, Notas Técnicas, Guia Prático
 * da EFD de Goiás e Tabelas de Goiás do WS de Tabelas Externas. Os intervalos são sempre
 * meio-abertos (`[from, to)`), com `to: null` para "vigente" e nunca vazios.
 *
 * A reconciliação entre versões de documento (versão corretiva no mesmo período fecha o
 * `knowledge` da anterior em `published_on`, sem dividir o tempo válido) é do caso de uso
 * `IngestDocumentVersion`, a partir da `replacementWindow` que os parsers devolvem.
 */

/** Códigos estáveis de revisão emitidos por estas regras (`ReviewFlag.reason`). */
export const LeiauteReviewReason = {
  /** Início declarado numa nota ("a partir de…") depois do fim da vigência do documento. */
  OutsideDocumentValidity: 'outside-document-validity',
  /** NT cuja obrigatoriedade começaria depois da próxima versão (intervalo vazio). */
  NtEmptyMandatory: 'nt-empty-mandatory',
  /** Linhas de uma tabela de códigos com intervalos sobrepostos para o mesmo código. */
  OverlappingRows: 'overlapping-rows',
} as const
export type LeiauteReviewReason = (typeof LeiauteReviewReason)[keyof typeof LeiauteReviewReason]

// ---------------------------------------------------------------------------------------------
// 1. Guia Prático (e leiautes da REINF): períodos de leiaute
// ---------------------------------------------------------------------------------------------

/** Entrada de `corpus/leiaute-periods.yaml`: uma versão de documento e o início do seu leiaute. */
export interface LeiautePeriodEntry {
  /** Identificador da versão (ex.: `3.2.4`). */
  readonly id: string
  /** Início do período de leiaute que a versão cobre (ex.: `2026-01-01`). */
  readonly from: IsoDate
}

/**
 * Tempo válido de cada versão: do início do seu período até o início do período seguinte
 * (`to: null` no último). Versões corretivas do mesmo período (mesmo `from`) recebem o mesmo
 * intervalo: o tempo válido não é dividido; quem fecha o `knowledge` da anterior é a reconciliação.
 */
export function leiautePeriodIntervals(
  entries: readonly LeiautePeriodEntry[],
): ReadonlyMap<string, ValidityInterval> {
  const starts = [...new Set(entries.map((entry) => entry.from))].sort()
  const result = new Map<string, ValidityInterval>()
  for (const entry of entries) {
    if (!isIsoDate(entry.from)) {
      throw new RangeError(`Início de leiaute inválido em ${entry.id}: ${entry.from}`)
    }
    if (result.has(entry.id)) {
      throw new RangeError(`Versão de leiaute repetida: ${entry.id}`)
    }
    const next = starts.find((start) => start > entry.from) ?? null
    result.set(entry.id, createInterval(entry.from, next))
  }
  return result
}

export interface NarrowedValidity {
  readonly validDuring: ValidityInterval
  readonly review?: ReviewFlag | undefined
}

/**
 * Estreita a vigência de um registro ou campo do Guia pelo início declarado ("campo incluído a
 * partir de…", "válido a partir de…"):
 *
 * - sem início, ou início até o começo do documento: a vigência do documento (nota histórica);
 * - início dentro da vigência do documento: `[início, fim do documento)`;
 * - início no fim do documento ou depois: a vigência do documento, com revisão
 *   (`outside-document-validity`), porque o resultado ficaria fora dela.
 */
export function narrowByDeclaredStart(
  documentValidity: ValidityInterval,
  declaredStart: IsoDate | null,
  rawNote: string | null = null,
): NarrowedValidity {
  if (declaredStart === null) {
    return { validDuring: documentValidity }
  }
  if (documentValidity.from !== null && declaredStart <= documentValidity.from) {
    return { validDuring: documentValidity }
  }
  if (!isNonEmptyInterval(declaredStart, documentValidity.to)) {
    return {
      validDuring: documentValidity,
      review: { reason: LeiauteReviewReason.OutsideDocumentValidity, rawNote },
    }
  }
  return { validDuring: createInterval(declaredStart, documentValidity.to) }
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

function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '')
}

function safeDate(year: number, month: number, day: number): IsoDate | null {
  try {
    return fromCalendarDate({ year, month, day })
  } catch {
    return null
  }
}

/** Mês por extenso (sem acento, minúsculo) para o número; `null` se não for um mês. */
export function monthNumber(name: string): number | null {
  return MONTHS[stripAccents(name).toLowerCase()] ?? null
}

const NUMERIC_DATE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/
// Os espaços já chegam colapsados (um só) por `parsePortugueseDate`.
const LONG_DATE = /^(\d{1,2})[º°]? de (\p{L}+) de (\d{4})$/u
const MONTH_YEAR = /^(\p{L}+) de (\d{4})$/u

/**
 * Data em português: `01/01/2027`, `01.01.2027`, `01-01-2027`, `1º de janeiro de 2027` ou
 * `janeiro de 2027` (dia 1). `null` se a forma não for reconhecida ou a data não existir.
 */
export function parsePortugueseDate(text: string): IsoDate | null {
  const value = text.trim().replace(/\s+/g, ' ')
  const numeric = NUMERIC_DATE.exec(value)
  if (numeric) {
    return safeDate(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]))
  }
  const long = LONG_DATE.exec(value)
  if (long) {
    const month = monthNumber(long[2] ?? '')
    return month === null ? null : safeDate(Number(long[3]), month, Number(long[1]))
  }
  const monthYear = MONTH_YEAR.exec(value)
  if (monthYear) {
    const month = monthNumber(monthYear[1] ?? '')
    return month === null ? null : safeDate(Number(monthYear[2]), month, 1)
  }
  return null
}

const DATE_FRAGMENT =
  '(\\d{1,2}[./-]\\d{1,2}[./-]\\d{4}|\\d{1,2}[º°]?\\s+de\\s+\\p{L}+\\s+de\\s+\\d{4}|\\p{L}+\\s+de\\s+\\d{4})'
/**
 * Formas aceitas como início declarado de um registro ou campo. Só verbos de validade/inclusão:
 * "A partir de 01/01/2018: Valores válidos…" descreve mudança de regra, não o início do campo.
 */
const DECLARED_START = new RegExp(
  `(?:v[aá]lid[oa]s?|inclu[ií]d[oa]s?|exigid[oa]s?|obrigat[oó]ri[oa]s?)\\s+a\\s+partir\\s+d[eo]\\s+(?:per[ií]odo\\s+de\\s+apura[cç][aã]o\\s+de\\s+)?${DATE_FRAGMENT}`,
  'iu',
)

/**
 * Início declarado numa nota do Guia ("Válido a partir de 01/01/2019", "campo incluído a partir
 * do período de apuração de janeiro de 2027"); a data mais tardia quando houver mais de uma.
 */
export function declaredStartInNote(note: string): IsoDate | null {
  const pattern = new RegExp(DECLARED_START.source, 'giu')
  let latest: IsoDate | null = null
  for (const match of note.matchAll(pattern)) {
    const date = parsePortugueseDate(match[1] ?? '')
    if (date !== null && (latest === null || date > latest)) {
      latest = date
    }
  }
  return latest
}

// ---------------------------------------------------------------------------------------------
// 2. Notas Técnicas
// ---------------------------------------------------------------------------------------------

export interface NtDates {
  readonly publishedOn: IsoDate
  /** Data de efeito declarada na NT; `null` = a do início facultativo ou obrigatório. */
  readonly effectiveFrom: IsoDate | null
  readonly optionalFrom: IsoDate | null
  /** Início da obrigatoriedade; `null` = a data de efeito (ou a publicação). */
  readonly mandatoryFrom: IsoDate | null
  /** Início da próxima versão da regra (NT seguinte); `null` = vigente. */
  readonly nextFrom: IsoDate | null
}

interface NtValidity {
  readonly validDuring: ValidityInterval
  readonly modality: Modality
  readonly retroactive: boolean
}

export interface NtValidityResult {
  readonly versions: readonly NtValidity[]
  readonly review?: ReviewFlag | undefined
}

/**
 * Vigências de uma NT: `optional` em `[optional_from, mandatory_from)` e `mandatory` em
 * `[mandatory_from, próxima)`. `retroactive` quando o efeito é anterior à publicação. Sem período
 * facultativo (ou com ele vazio), só a versão obrigatória. Se a próxima versão começar antes da
 * obrigatoriedade, a parte obrigatória fica vazia: sobra a facultativa (se houver) e a NT vai para
 * revisão.
 */
export function ntValidity(dates: NtDates): NtValidityResult {
  const mandatoryFrom = dates.mandatoryFrom ?? dates.effectiveFrom ?? dates.publishedOn
  const effectiveFrom = dates.effectiveFrom ?? dates.optionalFrom ?? mandatoryFrom
  const retroactive = effectiveFrom < dates.publishedOn
  const versions: NtValidity[] = []
  if (dates.optionalFrom !== null && dates.optionalFrom < mandatoryFrom) {
    const optionalTo =
      dates.nextFrom !== null && dates.nextFrom < mandatoryFrom ? dates.nextFrom : mandatoryFrom
    if (isNonEmptyInterval(dates.optionalFrom, optionalTo)) {
      versions.push({
        validDuring: createInterval(dates.optionalFrom, optionalTo),
        modality: Modality.Optional,
        retroactive,
      })
    }
  }
  if (!isNonEmptyInterval(mandatoryFrom, dates.nextFrom)) {
    return {
      versions,
      review: {
        reason: LeiauteReviewReason.NtEmptyMandatory,
        rawNote: `obrigatória a partir de ${mandatoryFrom}, próxima versão em ${String(dates.nextFrom)}`,
      },
    }
  }
  versions.push({
    validDuring: createInterval(mandatoryFrom, dates.nextFrom),
    modality: Modality.Mandatory,
    retroactive,
  })
  return { versions }
}

// ---------------------------------------------------------------------------------------------
// 4. Guia Prático da EFD de Goiás
// ---------------------------------------------------------------------------------------------

/**
 * `[published_on, próxima publicação)`, exibido como "versão publicada em X". Lança `RangeError`
 * se a próxima publicação não for posterior.
 */
export function publicationInterval(
  publishedOn: IsoDate,
  nextPublishedOn: IsoDate | null,
): ValidityInterval {
  return createInterval(publishedOn, nextPublishedOn)
}

/** Intervalos de uma série de publicações (datas distintas), na ordem cronológica. */
export function publicationIntervals(
  publishedOn: readonly IsoDate[],
): ReadonlyMap<IsoDate, ValidityInterval> {
  const dates = [...new Set(publishedOn)].sort()
  return new Map(
    dates.map((date, index) => [date, publicationInterval(date, dates[index + 1] ?? null)]),
  )
}

// ---------------------------------------------------------------------------------------------
// 5. Tabelas de Goiás (datas declaradas, não vigência jurídica)
// ---------------------------------------------------------------------------------------------

const DDMMAAAA = /^(\d{2})(\d{2})(\d{4})$/

/** Data `DDMMAAAA` do WS de Tabelas Externas; `null` se vazia, malformada ou inexistente. */
export function parseDdMmAaaa(text: string): IsoDate | null {
  const match = DDMMAAAA.exec(text.trim())
  if (!match) {
    return null
  }
  return safeDate(Number(match[3]), Number(match[2]), Number(match[1]))
}

/**
 * Linha de tabela `DT_INI`/`DT_FIM` (inclusivas) para `[DT_INI, DT_FIM + 1)`; `DT_FIM` nulo =
 * vigente. `null` quando `DT_FIM` é anterior a `DT_INI` (intervalo vazio: a linha é descartada).
 */
export function tableRowInterval(dtIni: IsoDate, dtFim: IsoDate | null): ValidityInterval | null {
  const to = dtFim === null ? null : addDays(dtFim, 1)
  return isNonEmptyInterval(dtIni, to) ? createInterval(dtIni, to) : null
}

/**
 * Índices das linhas que se sobrepõem a alguma linha anterior (na ordem dada) do mesmo código:
 * essas vão para revisão (`overlapping-rows`), e as demais publicam normalmente.
 */
export function overlappingRowIndexes(intervals: readonly ValidityInterval[]): readonly number[] {
  const flagged: number[] = []
  intervals.forEach((interval, index) => {
    if (intervals.slice(0, index).some((previous) => overlaps(previous, interval))) {
      flagged.push(index)
    }
  })
  return flagged
}
