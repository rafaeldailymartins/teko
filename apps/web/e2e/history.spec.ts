import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { enforcedViolations, recordViolations } from './support/csp.ts'
import { sessionCookie, signInWithTestSession } from './support/session.ts'

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
        cookie: sessionCookie(),
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
      headers: { cookie: sessionCookie() },
    })
    expect(list.headers()['cache-control']).toBe('private, no-store')
    const body = (await list.json()) as { items: { conversationId: string }[] }
    expect(body.items[0]?.conversationId).toBe(conversationId)

    await recordViolations(page)
    await signInWithTestSession(context, baseURL)
    await page.goto('/pt-BR/history/')
    const href = `/pt-BR/chat/?c=${conversationId}`
    const item = page.locator('main').locator(`a[href="${href}"]`)
    await expect(item).toBeVisible()
    await expect(item).toContainText('Ref. 05/2008')
    await expect(item).toContainText('Qual valor mínimo aplicado no GOYAZES')

    await item.click()
    await expect(page).toHaveURL(new RegExp(`/pt-BR/chat/\\?c=${conversationId}$`))
    // A conversa abre com a pergunta e a resposta gravadas, sem a abertura do chat vazio.
    await expect(page.locator('[data-message-role="user"]').first()).toContainText(
      'Qual valor mínimo aplicado no GOYAZES',
    )
    await expect(
      page.locator('article[data-message-role="assistant"] [data-reference-date]').first(),
    ).toHaveAttribute('data-reference-date', '2008-05-01')
    await expect(page.locator('[data-chat-welcome]')).toHaveCount(0)
    if (!isMobile) {
      // No desktop o painel de histórico do chat marca a conversa aberta.
      await expect(page.locator(`a[href="${href}"][aria-current="page"]`)).toBeVisible()
      // "Nova conversa" volta ao chat vazio.
      await page.getByRole('link', { name: 'Nova conversa' }).click()
      await expect(page).toHaveURL(/\/pt-BR\/chat\/$/)
      await expect(page.locator('[data-chat-welcome]')).toBeVisible()
    }
    await page.waitForLoadState('networkidle')
    expect(await enforcedViolations(page)).toEqual([])
  })

  test('sem sessão, o histórico leva ao login com o retorno', async ({ page }) => {
    await page.goto('/pt-BR/history/')
    // A guarda do grupo `(app)` manda para a entrada, com o caminho de volta.
    await expect(page).toHaveURL(/\/pt-BR\/sign-in\/\?callbackURL=%2Fpt-BR%2Fhistory%2F$/)
  })
})

test.describe('dispositivo e comparação', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signInWithTestSession(context, baseURL)
  })

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
