'use client'

import { useReportWebVitals } from 'next/web-vitals'
import { analytics } from '@/lib/analytics'
import { type WebVitalMetric, webVitalProperties } from '@/lib/analytics/web-vitals'

function report(metric: WebVitalMetric): void {
  const properties = webVitalProperties(metric)
  if (properties !== null) {
    analytics.capture('web_vital', properties)
  }
}

/**
 * Envia as Core Web Vitals como `web_vital`. Carregado por `lazy` só depois que o cliente de
 * analytics carregou (consentimento e chave pública): sem consentimento, nem o código do
 * `web-vitals` é baixado. Os observers usam `buffered`, então as métricas que já aconteceram
 * (TTFB, FCP, LCP) também chegam.
 */
export function WebVitalsReporter() {
  useReportWebVitals(report)
  return null
}
