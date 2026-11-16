import { expect, test } from '@playwright/test'
import { enforcedViolations, recordViolations } from './support/csp.ts'

/**
 * Página de cobertura na stack de CI, sem sessão: pública, nos dois idiomas, com as famílias da
 * fixture (`apps/api/test/fixtures/corpus/coverage.json`, verificadas em 2026-11-10) vindas de
 * `GET /api/v1/coverage`, e sem violação de CSP aplicada.
 */

const LOCALES = [
  {
    locale: 'pt-BR',
    title: 'Cobertura',
    federal: 'Federal',
    goias: 'Goiás',
    rcte: 'RCTE de Goiás',
    rcteRange: '01/01/1998 a 10/11/2026',
    verified: 'Fontes verificadas pela última vez em 10/11/2026.',
  },
  {
    locale: 'en',
    title: 'Coverage',
    federal: 'Federal',
    goias: 'Goiás',
    rcte: 'RCTE (Goiás)',
    rcteRange: '01/01/1998 to 11/10/2026',
    verified: 'Sources last checked on 11/10/2026.',
  },
] as const

test.describe('cobertura', () => {
  for (const expected of LOCALES) {
    test(`a página carrega sem sessão e mostra as famílias (${expected.locale})`, async ({
      page,
      context,
    }) => {
      expect(await context.cookies()).toEqual([])
      await recordViolations(page)
      const coverageResponse = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/api/v1/coverage',
      )
      await page.goto(`/${expected.locale}/coverage/`)
      expect((await coverageResponse).ok()).toBe(true)

      // Pública: nenhuma guarda manda para a entrada.
      await expect(page).toHaveURL(new RegExp(`/${expected.locale}/coverage/$`))
      await expect(page.locator('html')).toHaveAttribute('lang', expected.locale)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(expected.title)
      await expect(page.getByRole('heading', { level: 2, name: expected.federal })).toBeVisible()
      await expect(page.getByRole('heading', { level: 2, name: expected.goias })).toBeVisible()
      await expect(page.getByText(expected.verified)).toBeVisible()

      const rcte = page.locator('[data-family="rcte"]')
      await expect(rcte.getByRole('heading', { level: 3 })).toHaveText(expected.rcte)
      await expect(rcte).toContainText(expected.rcteRange)
      for (const family of ['efd-icms-ipi', 'efd-reinf', 'cte', 'efd-go', 'tabelas-go']) {
        await expect(page.locator(`[data-family="${family}"]`)).toBeVisible()
      }

      await page.waitForLoadState('networkidle')
      expect(await enforcedViolations(page)).toEqual([])
    })
  }
})
