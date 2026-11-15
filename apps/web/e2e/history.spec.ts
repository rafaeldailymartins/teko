import { randomUUID } from 'node:crypto'
import { type BrowserContext, expect, test } from '@playwright/test'
import { enforcedViolations, recordViolations } from './support/csp.ts'

/**
 * Histórico, dispositivo e comparação na stack de CI: a conversa criada pela API aparece no
 * histórico e abre no chat; a página de dispositivo mostra a redação, a linha do tempo e o diff sob
 * demanda; a comparação mostra o exemplo do roteiro (RCTE, art. 76, § 6º, 05/2008 contra 01/2010).
 * Nenhuma jornada pode disparar violação de CSP aplicada.
 */
test.use({ locale: 'pt-BR' })

const KEY = 'go:rcte:art:76:par:6'
const LABEL = 'RCTE, art. 76, § 6º'
const GOYAZES =
  'Qual valor mínimo aplicado no GOYAZES ou no PROESPORTE permitia ao Secretário da Fazenda definir prazos diversos de pagamento do ICMS?'

function sessionCookie(): { name: string; value: string; header: string } {
  const header = process.env['E2E_SESSION_COOKIE'] ?? ''
  const separator = header.indexOf('=')
  if (separator <= 0) {
    throw new Error('E2E_SESSION_COOKIE ausente: suba a stack com `bash infra/ci/up.sh`')
  }
  return { name: header.slice(0, separator), value: header.slice(separator + 1), header }
}

async function signIn(context: BrowserContext, baseURL: string | undefined): Promise<void> {
  const { name, value } = sessionCookie()
  await context.addCookies([{ name, value, url: new URL(baseURL ?? '').origin }])
}

test.describe('histórico', () => {
  test('a conversa feita pela API aparece no histórico e abre no chat', async ({
    page,
    context,
    request,
    baseURL,
    isMobile,
  }) => {
    const conversationId = randomUUID()
    const asked = await request.post<unknown>('/api/v1/questions', {
      headers: {
        origin: new URL(baseURL ?? '').origin,
        'content-type': 'application/json',
        cookie: sessionCookie().header,
      },
      data: {
        conversationId,
        question: `${GOYAZES} (${randomUUID()})`,
        locale: 'pt-BR',
        families: ['rcte'],
        periodoApuracao: '2008-05',
        source: 'periodo_apuracao',
      },
    })
    expect(asked.ok()).toBe(true)

    const list = await request.get<unknown>('/api/v1/conversations', {
      headers: { cookie: sessionCookie().header },
    })
    expect(list.headers()['cache-control']).toBe('private, no-store')
    const body = (await list.json()) as { items: { conversationId: string }[] }
    expect(body.items[0]?.conversationId).toBe(conversationId)

    await recordViolations(page)
    await signIn(context, baseURL)
    await page.goto('/pt-BR/history/')
    const href = `/pt-BR/chat/?c=${conversationId}`
    const item = page.locator('main').locator(`a[href="${href}"]`)
    await expect(item).toBeVisible()
    await expect(item).toContainText('Ref. 05/2008')
    await expect(item).toContainText('Qual valor mínimo aplicado no GOYAZES')

    await item.click()
    await expect(page).toHaveURL(new RegExp(`/pt-BR/chat/\\?c=${conversationId}$`))
    if (!isMobile) {
      // No desktop o painel de histórico do chat marca a conversa aberta.
      await expect(page.locator(`a[href="${href}"][aria-current="page"]`)).toBeVisible()
    }
    await page.waitForLoadState('networkidle')
    expect(await enforcedViolations(page)).toEqual([])
  })

  test('sem sessão, o histórico leva ao login', async ({ page }) => {
    await page.goto('/pt-BR/history/')
    await expect(page.locator('main [role="alert"]')).toContainText('Sua sessão expirou')
    await expect(page.locator('main [role="alert"] a')).toHaveAttribute('href', '/pt-BR/sign-in/')
  })
})

test.describe('dispositivo e comparação', () => {
  test('a página de dispositivo mostra a redação na data, a linha do tempo e o diff', async ({
    page,
  }) => {
    await recordViolations(page)
    await page.goto(`/pt-BR/provision/?k=${KEY}&ref=2008-05`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(LABEL)
    await expect(page.locator('main blockquote[lang="pt-BR"]')).toContainText('GOYAZES')
    await expect(page.getByText('Redação vigente em 01/05/2008.')).toBeVisible()

    const timeline = page.getByRole('list', { name: 'Redações do dispositivo' })
    await expect(timeline.getByRole('button')).not.toHaveCount(0)
    expect(await timeline.getByRole('button').count()).toBeGreaterThanOrEqual(2)

    const toggle = page.getByRole('button', {
      name: 'Ver o que mudou em relação à redação anterior',
    })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    // Aberto, o mesmo botão passa a se chamar "Esconder as mudanças".
    await expect(page.getByRole('button', { name: 'Esconder as mudanças' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(page.locator('main ins, main del').first()).toBeVisible()

    // A última redação da linha do tempo passa a ser a mostrada, pela URL.
    await timeline.getByRole('button').last().click()
    await expect(page).toHaveURL(/ref=\d{4}-\d{2}-\d{2}/)
    await page.waitForLoadState('networkidle')
    expect(await enforcedViolations(page)).toEqual([])
  })

  test('a comparação mostra o que mudou entre 05/2008 e 01/2010', async ({ page }) => {
    await recordViolations(page)
    await page.goto(`/pt-BR/compare/?k=${KEY}&from=2008-05&to=2010-01`)
    await expect(page.getByText('Em 01/05/2008')).toBeVisible()
    await expect(page.getByText('Em 01/01/2010')).toBeVisible()
    await expect(page.locator('main ins').first()).toBeVisible()
    await expect(page.locator('main del').first()).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(await enforcedViolations(page)).toEqual([])
  })
})
