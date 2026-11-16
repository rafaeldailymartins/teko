import type { AnalyticsEventProperties } from '@teko/shared/analytics'

/** O que o `useReportWebVitals` do Next entrega e o evento usa. */
export interface WebVitalMetric {
  readonly name: string
  readonly value: number
  readonly rating: string
}

type WebVitalProperties = AnalyticsEventProperties<'web_vital'>

const NAMES: ReadonlySet<string> = new Set<WebVitalProperties['name']>([
  'LCP',
  'INP',
  'CLS',
  'FCP',
  'TTFB',
])
const RATINGS: ReadonlySet<string> = new Set<WebVitalProperties['rating']>([
  'good',
  'needs-improvement',
  'poor',
])

function isName(name: string): name is WebVitalProperties['name'] {
  return NAMES.has(name)
}

function isRating(rating: string): rating is WebVitalProperties['rating'] {
  return RATINGS.has(rating)
}

/**
 * Propriedades do `web_vital` a partir de uma métrica (só nome, valor e classificação: sem o
 * `id`, a `navigationType` nem a atribuição). Métrica fora do catálogo vira `null`.
 */
export function webVitalProperties(metric: WebVitalMetric): WebVitalProperties | null {
  const { name, value, rating } = metric
  if (!isName(name) || !isRating(rating) || !Number.isFinite(value) || value < 0) {
    return null
  }
  return { name, value, rating }
}
