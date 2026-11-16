import { expect, type Page, test } from '@playwright/test'
import en from '../messages/en.json' with { type: 'json' }
import ptBR from '../messages/pt-BR.json' with { type: 'json' }
import { enforcedViolations, recordViolations } from './support/csp.ts'
import { signInWithTestSession } from './support/session.ts'

/**
 * Fundação visual e correções de plataforma (mudança `redesign-brand-and-shell`): o app só aparece
 * com a sessão pronta (sem pintar o shell e pular para a entrada), a raiz sem tela de idioma, o
 * menu de idioma que mantém a página e a query, e a logo, os ícones e o Open Graph.
 */

/** Marca na janela se a navegação principal do app chegou a aparecer (antes de qualquer script). */
async function watchAppShell(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = window as unknown as { __appShellPainted: boolean }
    target.__appShellPainted = false
    new MutationObserver(() => {
      if (document.querySelector('nav[aria-label="Navegação principal"]') !== null) {
        target.__appShellPainted = true
      }
    }).observe(document, { subtree: true, childList: true })
  })
}

test.describe('guarda de sessão sem flash', () => {
  test.use({ locale: 'pt-BR' })

  test('sem sessão, "Abrir o Tekó" vai para a entrada sem mostrar o app', async ({ page }) => {
    await recordViolations(page)
    await watchAppShell(page)
    await page.goto('/pt-BR/')
    await page
      .getByRole('link', { name: ptBR.common.openApp })
      .filter({ visible: true })
      .first()
      .click()
    await expect(page).toHaveURL(/\/pt-BR\/sign-in\/\?callbackURL=%2Fpt-BR%2Fchat%2F$/)
    const painted = await page.evaluate(
      () => (window as unknown as { __appShellPainted: boolean }).__appShellPainted,
    )
    expect(painted).toBe(false)
    await page.waitForLoadState('networkidle')
    expect(await enforcedViolations(page)).toEqual([])
  })

  test('com sessão, o app aparece depois da tela da marca', async ({ page, context, baseURL }) => {
    await signInWithTestSession(context, baseURL)
    await page.goto('/pt-BR/history/')
    await expect(page.getByRole('navigation', { name: ptBR.shell.mainNav })).toBeVisible()
    await expect(page.getByText(ptBR.shell.gate.loading)).toBeHidden()
  })

  test.describe('HTML estático', () => {
    test.use({ javaScriptEnabled: false })

    test('as páginas do app saem só com a tela da marca', async ({ page }) => {
      await page.goto('/pt-BR/chat/')
      await expect(page.getByRole('status')).toHaveText(ptBR.shell.gate.loading)
      await expect(page.getByRole('navigation', { name: ptBR.shell.mainNav })).toHaveCount(0)
      await expect(page.getByRole('textbox')).toHaveCount(0)
    })
  })
})

test.describe('raiz sem tela de idioma', () => {
  test.use({ locale: 'en-US' })

  test('a raiz e a página de entrada levam direto ao idioma do navegador', async ({ page }) => {
    for (const path of ['/', '/index.html']) {
      await page.goto(path)
      await expect(page).toHaveURL(/\/en\/$/)
      await expect(page.locator('html')).toHaveAttribute('lang', 'en')
      await expect(page.getByText(en.gateway.title)).toHaveCount(0)
    }
  })
})

test.describe('menu de idioma', () => {
  test('no site, mantém a página e a âncora', async ({ page }) => {
    await page.goto('/pt-BR/privacy/#retention')
    await page.getByRole('banner').getByRole('button', { name: ptBR.common.language.label }).click()
    const english = page.getByRole('menuitem', { name: /English/ })
    await expect(english).toHaveAttribute('href', '/en/privacy/#retention')
    await english.click()
    await expect(page).toHaveURL(/\/en\/privacy\/#retention$/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })

  test('no app, mantém a query', async ({ page, context, baseURL }) => {
    await signInWithTestSession(context, baseURL)
    await page.goto('/pt-BR/chat/?ref=2008-05')
    await page.getByRole('banner').getByRole('button', { name: ptBR.common.language.label }).click()
    await page.getByRole('menuitem', { name: /English/ }).click()
    await expect(page).toHaveURL(/\/en\/chat\/\?ref=2008-05$/)
  })
})

test.describe('marca', () => {
  test('favicon, ícone da Apple, theme-color e Open Graph com a logo', async ({
    page,
    request,
  }) => {
    await page.goto('/pt-BR/')
    const head = page.locator('head')
    await expect(head.locator('link[rel="icon"][href="/icon.svg"]')).toHaveCount(1)
    await expect(head.locator('link[rel="apple-touch-icon"][href="/apple-icon.png"]')).toHaveCount(
      1,
    )
    await expect(head.locator('meta[name="theme-color"]')).toHaveCount(2)
    await expect(head.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/og\.png$/)
    for (const asset of ['/icon.svg', '/apple-icon.png', '/og.png']) {
      expect((await request.get(asset)).status(), asset).toBe(200)
    }
  })

  test('o cabeçalho tem a logo e a chamada para o app', async ({ page, isMobile }) => {
    await page.goto('/pt-BR/')
    const banner = page.getByRole('banner')
    await expect(banner.getByRole('link', { name: ptBR.common.homeLink })).toBeVisible()
    if (isMobile) {
      await banner.getByRole('button', { name: ptBR.common.menu.open }).click()
      await expect(
        page.getByRole('dialog').getByRole('link', { name: ptBR.common.openApp }),
      ).toBeVisible()
    } else {
      await expect(banner.getByRole('link', { name: ptBR.common.openApp })).toBeVisible()
    }
  })
})
