import { expect, type Page, type Request, type Route, test } from '@playwright/test'
import { POSTHOG_API_HOST } from '../src/lib/analytics/posthog-hosts.ts'

/**
 * Erros do navegador no PostHog Error Tracking (ADR 0037), na stack de CI: o build tem a chave
 * fictícia dos erros (`infra/ci/up.sh`), a rede para o PostHog é interceptada aqui (nenhum pedido
 * sai; o `playwright.config.ts` ainda tira o DNS do PostHog do navegador) e a consulta de cobertura
 * é forçada a um 500 `internal` com um `trace_id` conhecido. Sem consentimento de medição (o estado
 * inicial das jornadas é a recusa), o erro vai à UE como `$exception`, com o `trace_id` da resposta
 * e o release do build, e nada é gravado no navegador.
 *
 * O `posthog-js` descarta eventos de robôs (`navigator.webdriver`, o user agent e as marcas do
 * `userAgentData` do Chromium headless): só aqui o navegador se apresenta como um Chrome comum, para
 * o evento sair.
 */

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c'
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'

test.use({ userAgent: CHROME_UA })

interface Sent {
  readonly url: string
  readonly body: string
}

/** Responde vazio aos hosts do PostHog (com CORS) e guarda o que o SDK mandou. */
async function mockPosthog(page: Page): Promise<Sent[]> {
  const sent: Sent[] = []
  await page.route(/^https:\/\/[^/]*posthog\.com\//, async (route: Route) => {
    const request: Request = route.request()
    if (request.method() === 'POST') {
      sent.push({ url: request.url(), body: request.postData() ?? '' })
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
  return sent
}

/** Eventos `$exception` nos corpos enviados (sem compressão na instância de erros). */
function exceptionsIn(sent: readonly Sent[]): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = []
  for (const { body } of sent) {
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      continue
    }
    // `{ api_key, batch: [...] }` no `/e/`; um evento solto nos outros caminhos.
    const inner: unknown =
      typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'batch') : undefined
    let batch: unknown[] = [parsed]
    if (Array.isArray(inner)) {
      batch = inner
    } else if (Array.isArray(parsed)) {
      batch = parsed
    }
    for (const event of batch) {
      if (
        typeof event === 'object' &&
        event !== null &&
        Reflect.get(event, 'event') === '$exception'
      ) {
        events.push(Reflect.get(event, 'properties') as Record<string, unknown>)
      }
    }
  }
  return events
}

test.describe('erros do navegador', () => {
  test('500 da API vira $exception na UE com o trace_id, sem cookie nem storage', async ({
    page,
    context,
  }) => {
    test.skip(test.info().project.name === 'mobile', 'mesmo caminho no desktop')
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
      // O Chromium headless anuncia a marca `HeadlessChrome` aqui também.
      Object.defineProperty(navigator, 'userAgentData', { get: () => undefined })
    })
    const sent = await mockPosthog(page)
    await page.route('**/api/v1/coverage', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        headers: { 'x-trace-id': TRACE_ID },
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Internal error',
          status: 500,
          code: 'internal',
          traceId: TRACE_ID,
        }),
      }),
    )

    await page.goto('/pt-BR/coverage/')
    await expect.poll(() => exceptionsIn(sent).length, { timeout: 30_000 }).toBeGreaterThan(0)

    const [exception] = exceptionsIn(sent)
    expect(exception?.['trace_id']).toBe(TRACE_ID)
    expect(String(exception?.['release'])).toMatch(/^teko@/)
    expect(JSON.stringify(exception?.['$exception_list'])).toContain('ApiError')
    expect(String(exception?.['$current_url'])).not.toContain('?')
    for (const { url } of sent) {
      expect(new URL(url).origin).toBe(POSTHOG_API_HOST)
    }
    expect(await context.cookies()).toEqual([])
    const storage = await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    }))
    // Só a escolha de consentimento do estado inicial; nada do PostHog.
    expect(storage.local).toEqual(['teko-consent'])
    expect(storage.session).toEqual([])
  })

  test('sem erro e sem consentimento, nada vai ao PostHog', async ({ page }) => {
    const requests: string[] = []
    page.on('request', (request) => {
      if (/posthog/i.test(request.url())) {
        requests.push(request.url())
      }
    })
    await page.goto('/pt-BR/coverage/')
    await page.waitForLoadState('networkidle')
    expect(requests).toEqual([])
  })
})
