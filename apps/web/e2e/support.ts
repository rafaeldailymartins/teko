import type { BrowserContext, Page } from '@playwright/test'

/**
 * Apoio comum das jornadas na stack de CI: violações de CSP registradas desde o primeiro byte e a
 * sessão de teste (`E2E_SESSION_COOKIE`, gravada pelo `infra/ci/up.sh`) injetada no navegador.
 */

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

/** `nome=valor` do cookie de sessão da stack de CI. */
export function sessionCookie(): string {
  const cookie = process.env['E2E_SESSION_COOKIE']
  if (cookie === undefined || cookie === '') {
    throw new Error('E2E_SESSION_COOKIE ausente: suba a stack com `bash infra/ci/up.sh`')
  }
  return cookie
}

/**
 * Entra com a sessão de teste (usuário `E2E`, onboarding concluído) pondo o cookie no contexto do
 * navegador, para a origem da stack. Nenhuma jornada sai nem exclui a conta: a sessão é
 * compartilhada pelos workers.
 */
export async function signInWithTestSession(
  context: BrowserContext,
  baseURL: string | undefined,
): Promise<void> {
  const cookie = sessionCookie()
  const separator = cookie.indexOf('=')
  await context.addCookies([
    {
      name: cookie.slice(0, separator),
      value: cookie.slice(separator + 1),
      url: new URL(baseURL ?? 'http://localhost:8080').origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
}
