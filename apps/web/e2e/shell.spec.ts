import { expect, test } from '@playwright/test'
import { signInWithTestSession } from './support/session.ts'

/**
 * Jornadas do app shell e do design system (mudança `add-web-shell-and-design-system`): páginas
 * estáticas nos dois locales, paleta de comandos, tema persistido, painéis no desktop e Sheet e
 * Drawer no celular, landing sem chamada à API. As páginas do app pedem sessão (sem ela, a guarda
 * manda para a entrada; `auth.spec.ts`), então as jornadas entram com a sessão de teste.
 */

test.beforeEach(async ({ context, baseURL }) => {
  await signInWithTestSession(context, baseURL)
})
const PAGES = [
  'chat',
  'history',
  'settings',
  'provision',
  'compare',
  'coverage',
  'about',
  'privacy',
  'terms',
  'sign-in',
] as const

test.describe('páginas', () => {
  test('as dez páginas existem nos dois locales, com título e idioma', async ({ page }) => {
    for (const locale of ['pt-BR', 'en'] as const) {
      for (const path of PAGES) {
        const response = await page.goto(`/${locale}/${path}/`)
        expect(response?.ok(), `/${locale}/${path}/`).toBe(true)
        await expect(page.locator('html')).toHaveAttribute('lang', locale)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await expect(page).toHaveTitle(/Tekó/)
      }
    }
  })

  test('o app shell mostra o aviso discreto e troca o idioma sem perder a página', async ({
    page,
  }) => {
    // No chat, o aviso fica logo abaixo do composer, sempre à vista.
    await page.goto('/pt-BR/chat/')
    await expect(page.getByText('Apoio à consulta; não constitui parecer.')).toBeInViewport()
    // Nas outras páginas do app, numa linha pequena no fim do conteúdo.
    await page.goto('/pt-BR/settings/')
    const disclaimer = page.getByRole('main').getByText('Apoio à consulta; não constitui parecer.')
    await disclaimer.scrollIntoViewIfNeeded()
    await expect(disclaimer).toBeInViewport()
    await page.getByRole('banner').getByRole('button', { name: 'Idioma', exact: true }).click()
    await page.getByRole('menuitem', { name: /English/ }).click()
    await expect(page).toHaveURL(/\/en\/settings\/$/)
  })

  test('a landing não chama a API', async ({ page }) => {
    const apiCalls: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls.push(request.url())
    })
    await page.goto('/pt-BR/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.getByText('O Tekó substitui um contador ou um advogado?').click()
    await expect(page.getByText('Não. Ele é um apoio à consulta')).toBeVisible()
    expect(apiCalls).toEqual([])
  })
})

test.describe('paleta e tema', () => {
  test('Ctrl+K abre a paleta, que navega para a página escolhida', async ({ page }) => {
    await page.goto('/pt-BR/chat/')
    // O shell (e o atalho) só monta depois da tela da marca, quando a sessão é conferida.
    await expect(page.getByRole('banner').getByRole('button', { name: 'Buscar' })).toBeVisible()
    await page.keyboard.press('Control+K')
    const dialog = page.getByRole('dialog', { name: 'Paleta de comandos' })
    await expect(dialog).toBeVisible()
    await page.keyboard.type('Histórico')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/pt-BR\/history\/$/)
    await expect(dialog).toBeHidden()
  })

  test('o tema escolhido vale depois de recarregar', async ({ page }) => {
    await page.goto('/pt-BR/about/')
    await page.getByRole('button', { name: 'Tema' }).click()
    await page.getByRole('menuitemradio', { name: 'Escuro' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })
})

test.describe('área de trabalho do chat', () => {
  test('desktop: duas colunas, sem citação vazia, e o histórico recolhido é lembrado', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'layout de desktop')
    await page.goto('/pt-BR/chat/')
    await expect(page.getByRole('region', { name: 'Histórico' })).toBeVisible()
    // A citação só aparece aberta por um chip ou uma fonte (`chat.spec.ts`).
    await expect(page.getByRole('region', { name: 'Citação' })).toHaveCount(0)
    await expect(page.getByRole('separator')).toHaveCount(0)

    await page.getByRole('button', { name: 'Recolher o histórico' }).click()
    await expect(page.getByRole('region', { name: 'Histórico' })).toHaveCount(0)
    const expand = page.getByRole('button', { name: 'Mostrar o histórico' })
    await expect(expand).toBeFocused()
    // Recolhido, o atalho de nova conversa continua à vista.
    await expect(page.getByRole('link', { name: 'Nova conversa' })).toBeVisible()

    await page.reload()
    await expect(expand).toBeVisible()
    await expect(page.getByRole('region', { name: 'Histórico' })).toHaveCount(0)
    await expand.click()
    await expect(page.getByRole('region', { name: 'Histórico' })).toBeVisible()
  })

  test('celular: só a conversa, com o histórico num Sheet', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'layout de celular')
    await page.goto('/pt-BR/chat/')
    await expect(page.getByRole('region', { name: 'Histórico' })).toBeHidden()
    await expect(page.getByRole('separator')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Citação' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Histórico' }).click()
    await expect(page.getByRole('dialog', { name: 'Histórico' })).toBeVisible()
  })

  test('as preferências de cookies ficam no menu da conta', async ({ page }) => {
    await page.goto('/pt-BR/chat/')
    await page
      .getByRole('banner')
      .getByRole('button', { name: /Conta de / })
      .click()
    await page.getByRole('menuitem', { name: 'Preferências de cookies' }).click()
    await expect(page.getByRole('dialog', { name: 'Preferências de cookies' })).toBeVisible()
  })
})
