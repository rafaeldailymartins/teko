import { addDays, compareIsoDates, type IsoDate, isoDateInTimeZone } from '@teko/shared/vigencia'

/**
 * Agrupamento e busca do histórico de conversas, no fuso de São Paulo (o mesmo da data de
 * referência): hoje, ontem, os últimos 7 e 30 dias e as anteriores.
 */
export const HistoryGroup = {
  Today: 'today',
  Yesterday: 'yesterday',
  Week: 'week',
  Month: 'month',
  Older: 'older',
} as const
export type HistoryGroup = (typeof HistoryGroup)[keyof typeof HistoryGroup]

const GROUP_ORDER: readonly HistoryGroup[] = Object.values(HistoryGroup)

interface Dated {
  /** Instante da última pergunta (ISO 8601). */
  readonly updatedAt: string
}

/** Grupo de um instante em relação a hoje (datas no fuso de São Paulo). */
export function historyGroupOf(updatedAt: string, today: IsoDate): HistoryGroup {
  const day = isoDateInTimeZone(new Date(updatedAt))
  if (compareIsoDates(day, today) >= 0) return HistoryGroup.Today
  if (day === addDays(today, -1)) return HistoryGroup.Yesterday
  if (compareIsoDates(day, addDays(today, -7)) >= 0) return HistoryGroup.Week
  if (compareIsoDates(day, addDays(today, -30)) >= 0) return HistoryGroup.Month
  return HistoryGroup.Older
}

/** Os itens (já em ordem, do mais recente) em grupos na ordem de `HistoryGroup`, sem grupo vazio. */
export function groupHistory<T extends Dated>(
  items: readonly T[],
  today: IsoDate,
): { readonly group: HistoryGroup; readonly items: readonly T[] }[] {
  const groups = new Map<HistoryGroup, T[]>()
  for (const item of items) {
    const group = historyGroupOf(item.updatedAt, today)
    groups.set(group, [...(groups.get(group) ?? []), item])
  }
  return GROUP_ORDER.flatMap((group) => {
    const grouped = groups.get(group)
    return grouped === undefined ? [] : [{ group, items: grouped }]
  })
}

/** Sem acento e em minúsculas: "Crédito" casa com "credito". */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

/** Filtra pelo título; cada palavra da busca precisa aparecer (busca vazia devolve tudo). */
export function filterByTitle<T extends { readonly title: string }>(
  items: readonly T[],
  query: string,
): readonly T[] {
  const words = normalize(query)
    .split(/\s+/)
    .filter((word) => word !== '')
  if (words.length === 0) return items
  return items.filter((item) => {
    const title = normalize(item.title)
    return words.every((word) => title.includes(word))
  })
}
