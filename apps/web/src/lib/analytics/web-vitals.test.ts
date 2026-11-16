import { parseAnalyticsProperties } from '@teko/shared/analytics'
import { describe, expect, it } from 'vitest'
import { webVitalProperties } from './web-vitals.ts'

describe('webVitalProperties', () => {
  it.each(['LCP', 'INP', 'CLS', 'FCP', 'TTFB'])('%s vira web_vital válido', (name) => {
    const properties = webVitalProperties({ name, value: 0.12, rating: 'good' })
    expect(properties).toEqual({ name, value: 0.12, rating: 'good' })
    expect(parseAnalyticsProperties('web_vital', properties)).toEqual(properties)
  })

  it.each([
    ['métrica fora do catálogo', { name: 'FID', value: 10, rating: 'good' }],
    ['classificação desconhecida', { name: 'LCP', value: 10, rating: 'ok' }],
    ['valor negativo', { name: 'LCP', value: -1, rating: 'good' }],
    ['valor não finito', { name: 'CLS', value: Number.NaN, rating: 'poor' }],
  ])('%s: nada', (_case, metric) => {
    expect(webVitalProperties(metric)).toBeNull()
  })
})
