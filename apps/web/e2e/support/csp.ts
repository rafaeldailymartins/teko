import type { Page } from '@playwright/test'

/** Violação de CSP registrada na página (as jornadas na stack de CI conferem desde o primeiro byte). */
export interface Violation {
  readonly directive: string
  readonly blocked: string
  readonly disposition: string
}

/** Junta as violações de CSP da página (`securitypolicyviolation`) desde o primeiro byte. */
export async function recordViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = window as unknown as { __cspViolations: Violation[] }
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

/** Violações aplicadas (o Trusted Types está em report-only até a v0.1.0 e não reprova). */
export async function enforcedViolations(page: Page): Promise<Violation[]> {
  const all = await page.evaluate(
    () => (window as unknown as { __cspViolations: Violation[] }).__cspViolations,
  )
  return all.filter((violation) => violation.disposition === 'enforce')
}
