import type { Page } from '@playwright/test'

/**
 * Violações de CSP de uma jornada, no mesmo padrão do `platform.spec.ts`: um listener de
 * `securitypolicyviolation` desde o primeiro byte e, no fim, só as aplicadas (o Trusted Types
 * está em report-only até a v0.1.0).
 */
interface CspViolation {
  readonly directive: string
  readonly blocked: string
  readonly disposition: string
}

export async function recordCspViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = window as unknown as { __cspViolations: CspViolation[] }
    target.__cspViolations = []
    document.addEventListener('securitypolicyviolation', (event) => {
      target.__cspViolations.push({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
        disposition: event.disposition,
      })
    })
  })
}

export async function enforcedCspViolations(page: Page): Promise<CspViolation[]> {
  const all = await page.evaluate(
    () => (window as unknown as { __cspViolations: CspViolation[] }).__cspViolations,
  )
  return all.filter((violation) => violation.disposition === 'enforce')
}
