import { type BrowserContext, expect, type Page, type Route, test } from '@playwright/test'
import ptBR from '../messages/pt-BR.json' with { type: 'json' }
import { POSTHOG_API_HOST, POSTHOG_ORIGINS } from '../src/lib/analytics/posthog-hosts.ts'
import { enforcedViolations, recordViolations } from './support/csp.ts'

/**
 * Consentimento LGPD (DoD da F5 e F6): antes da escolha, zero cookies e nenhuma chave do PostHog no
 * storage nem pedido a ele; recusar mantém assim; aceitar carrega o `posthog-js` (a stack de CI
 * builda com uma chave fictícia, `infra/ci/up.sh`) e ele só fala com os hosts da UE, interceptados
 * aqui (nenhum pedido sai para a rede); retirar o consentimento apaga o que ele gravou; o link do
 * rodapé reabre as preferências.
 */

// Primeira visita: sem o estado inicial do `playwright.config.ts` (que já traz a escolha feita).
test.use({ locale: 'pt-BR', storageState: { cookies: [], origins: [] } })

const CONSENT_KEY = 'teko-consent'
const { banner: bannerText, preferences, footerLink } = ptBR.consent

interface BrowserStorage {
  readonly local: Record<string, string>
  readonly session: Record<string, string>
}

async function browserStorage(page: Page): Promise<BrowserStorage> {
  return page.evaluate(() => ({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
  }))
}

/** Chaves do PostHog (`ph_<chave>_posthog`, `__ph_opt_in_out_…`, `posthog…`). */
function posthogKeys(storage: Record<string, string>): string[] {
  return Object.keys(storage).filter((key) => /^(?:__)?ph_/i.test(key) || /posthog/i.test(key))
}

/** Pedidos a qualquer host do PostHog (SDK, ingestão ou configuração remota). */
function trackPosthogRequests(page: Page): string[] {
  const requests: string[] = []
  page.on('request', (request) => {
    if (/posthog/i.test(request.url())) {
      requests.push(request.url())
    }
  })
  return requests
}

/** Origem de um pedido ao PostHog (`https://eu.i.posthog.com`). */
function originOf(url: string): string {
  return new URL(url).origin
}

/**
 * Intercepta todo host do PostHog: a UE responde vazio (com CORS, porque o SDK chama de outra
 * origem), e qualquer outro host é abortado, para o teste acusar sem a rede real.
 */
async function mockPosthog(page: Page): Promise<void> {
  await page.route(/^https:\/\/[^/]*posthog\.com\//, async (route: Route) => {
    const request = route.request()
    if (!POSTHOG_ORIGINS.some((origin) => origin === originOf(request.url()))) {
      await route.abort('blockedbyclient')
      return
    }
    const origin = (await request.headerValue('origin')) ?? '*'
    await route.fulfill({
      status: request.method() === 'OPTIONS' ? 204 : 200,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers':
          (await request.headerValue('access-control-request-headers')) ?? '*',
      },
      body: request.method() === 'OPTIONS' ? '' : '{}',
    })
  })
}

async function expectNothingStored(page: Page, context: BrowserContext): Promise<void> {
  expect(await context.cookies()).toEqual([])
  const storage = await browserStorage(page)
  expect(posthogKeys(storage.local)).toEqual([])
  expect(posthogKeys(storage.session)).toEqual([])
}

function storedChoice(storage: BrowserStorage): { analytics: boolean; surveys: boolean } {
  const raw = storage.local[CONSENT_KEY]
  expect(raw, 'escolha gravada').toBeDefined()
  return (JSON.parse(raw ?? '{}') as { choices: { analytics: boolean; surveys: boolean } }).choices
}

test.describe('consentimento', () => {
  test.beforeEach(async ({ page }) => {
    await recordViolations(page)
    await mockPosthog(page)
  })

  test('primeira visita: banner, zero cookies e nada gravado no storage', async ({
    page,
    context,
  }) => {
    const posthog = trackPosthogRequests(page)
    await page.goto('/pt-BR/')
    const banner = page.getByTestId('consent-banner')
    await expect(banner).toBeVisible()
    await expect(banner.getByRole('heading', { name: bannerText.title })).toBeVisible()
    await page.waitForLoadState('networkidle')

    await expectNothingStored(page, context)
    expect((await browserStorage(page)).local).toEqual({})
    expect(posthog).toEqual([])
    expect(await enforcedViolations(page)).toEqual([])
  })

  test('Aceitar, Recusar e Personalizar têm o mesmo peso visual', async ({ page }) => {
    await page.goto('/pt-BR/')
    const banner = page.getByTestId('consent-banner')
    const buttons = [bannerText.accept, bannerText.reject, bannerText.customize].map((name) =>
      banner.getByRole('button', { name, exact: true }),
    )
    const classes = await Promise.all(buttons.map((button) => button.getAttribute('class')))
    expect(new Set(classes).size).toBe(1)
    const heights = await Promise.all(
      buttons.map(async (button) => (await button.boundingBox())?.height),
    )
    expect(new Set(heights).size).toBe(1)
  })

  test('Recusar mantém zero cookies, grava só a escolha e não volta a perguntar', async ({
    page,
    context,
  }) => {
    const posthog = trackPosthogRequests(page)
    await page.goto('/pt-BR/')
    await page
      .getByTestId('consent-banner')
      .getByRole('button', { name: bannerText.reject, exact: true })
      .click()
    await expect(page.getByTestId('consent-banner')).toBeHidden()

    await expectNothingStored(page, context)
    const storage = await browserStorage(page)
    expect(Object.keys(storage.local)).toEqual([CONSENT_KEY])
    expect(storedChoice(storage)).toEqual({ analytics: false, surveys: false })

    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('consent-banner')).toBeHidden()
    expect(await context.cookies()).toEqual([])
    expect(posthog).toEqual([])
    expect(await enforcedViolations(page)).toEqual([])
  })

  test('Aceitar carrega o PostHog, que só fala com a UE e não grava cookie', async ({
    page,
    context,
  }) => {
    const posthog = trackPosthogRequests(page)
    await page.goto('/pt-BR/')
    await page.waitForLoadState('networkidle')
    expect(posthog, 'nada antes do aceite').toEqual([])

    // O `consent_updated` sai no primeiro lote de eventos, para o host de ingestão da UE.
    const ingestion = page.waitForRequest(
      (request) => request.url().startsWith(`${POSTHOG_API_HOST}/`) && request.method() === 'POST',
      { timeout: 20_000 },
    )
    await page
      .getByTestId('consent-banner')
      .getByRole('button', { name: bannerText.accept, exact: true })
      .click()
    await expect(page.getByTestId('consent-banner')).toBeHidden()
    await ingestion

    expect(storedChoice(await browserStorage(page))).toEqual({ analytics: true, surveys: true })
    expect(posthog.length).toBeGreaterThan(0)
    const outsideEu = posthog.filter(
      (url) => !POSTHOG_ORIGINS.some((origin) => origin === originOf(url)),
    )
    expect(outsideEu, 'pedidos fora dos hosts da UE').toEqual([])
    // Persistência só no `localStorage`: nenhum cookie, nem do PostHog.
    expect(await context.cookies()).toEqual([])
    await expect
      .poll(async () => posthogKeys((await browserStorage(page)).local).length)
      .toBeGreaterThan(0)
    expect(await enforcedViolations(page)).toEqual([])
  })

  test('Personalizar e o link do rodapé abrem as preferências por categoria', async ({
    page,
    context,
  }) => {
    await page.goto('/pt-BR/')
    await page
      .getByTestId('consent-banner')
      .getByRole('button', { name: bannerText.customize, exact: true })
      .click()
    const dialog = page.getByRole('dialog', { name: preferences.title })
    await expect(dialog).toBeVisible()
    const analytics = dialog.getByRole('switch', { name: preferences.analytics.title })
    await expect(analytics).not.toBeChecked()
    await analytics.click()
    await dialog.getByRole('button', { name: preferences.save, exact: true }).click()
    await expect(dialog).toBeHidden()
    expect(storedChoice(await browserStorage(page))).toEqual({ analytics: true, surveys: false })
    // Com a medição aceita, o SDK carrega e grava o identificador anônimo no `localStorage`.
    await expect
      .poll(async () => posthogKeys((await browserStorage(page)).local).length)
      .toBeGreaterThan(0)

    // O link do rodapé reabre com a escolha salva, e dá para retirar o consentimento.
    await page.getByRole('contentinfo').getByRole('button', { name: footerLink }).click()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('switch', { name: preferences.analytics.title })).toBeChecked()
    await dialog.getByRole('button', { name: preferences.rejectAll, exact: true }).click()
    await expect(dialog).toBeHidden()
    expect(storedChoice(await browserStorage(page))).toEqual({ analytics: false, surveys: false })
    // Retirar o consentimento apaga o que o PostHog gravou (e ele não volta a gravar).
    await expect.poll(async () => posthogKeys((await browserStorage(page)).local).length).toBe(0)
    await page.waitForTimeout(1000)
    await expectNothingStored(page, context)
    expect(await enforcedViolations(page)).toEqual([])
  })
})
