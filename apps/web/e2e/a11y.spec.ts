import { writeFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, type TestInfo, test } from '@playwright/test'
import type { Locale } from '@teko/shared/i18n'
import en from '../messages/en.json' with { type: 'json' }
import ptBR from '../messages/pt-BR.json' with { type: 'json' }
import { signInWithTestSession } from './support/session.ts'

/**
 * Acessibilidade (DoD da F5): axe sem nenhuma violação WCAG 2.2 AA nas rotas principais, nos dois
 * idiomas, nos temas claro e escuro, nos projetos desktop e mobile do `playwright.config.ts`. As
 * rotas do grupo `(app)` entram com a sessão de teste da stack de CI.
 *
 * Exceção só por seletor, com o motivo (`EXCEPTIONS`); nada de desligar regra para a página toda.
 * Na falha, o resultado completo do axe vai anexado ao teste (e sai no artifact de traces do job).
 */

const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

interface Exception {
  /** Seletor CSS do elemento excluído da análise. */
  readonly selector: string
  /** Por que o axe não se aplica ali (ou erra ali). */
  readonly reason: string
}

/** Elementos fora da análise. Vazia: hoje nenhuma rota precisa de exceção. */
const EXCEPTIONS: readonly Exception[] = []

const MESSAGES = { en, 'pt-BR': ptBR } as const satisfies Record<Locale, typeof en>

const KEY = 'go:rcte:art:76:par:6'

interface Route {
  readonly name: string
  /** Caminho depois do locale, com a barra final do export. */
  readonly path: string
  /** Rota do grupo `(app)`: entra com a sessão de teste. */
  readonly session?: true
}

const ROUTES: readonly Route[] = [
  { name: 'landing', path: '' },
  { name: 'sign-in', path: 'sign-in/' },
  { name: 'chat vazio', path: 'chat/', session: true },
  { name: 'history', path: 'history/', session: true },
  { name: 'provision', path: `provision/?k=${KEY}&ref=2008-05`, session: true },
  { name: 'provision (busca)', path: 'provision/?ref=2008-05', session: true },
  { name: 'compare', path: `compare/?k=${KEY}&from=2008-05&to=2010-01`, session: true },
  { name: 'compare (vazio)', path: 'compare/', session: true },
  { name: 'settings', path: 'settings/', session: true },
  { name: 'privacy', path: 'privacy/' },
  { name: 'terms', path: 'terms/' },
  { name: 'about', path: 'about/' },
  { name: 'coverage', path: 'coverage/' },
  { name: '404', path: 'rota-que-nao-existe/' },
]

const THEMES = ['light', 'dark'] as const

/**
 * Espera a página assentar: rede parada, o título da página presente, fontes carregadas e nenhuma
 * animação em curso.
 */
async function settled(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle')
  await expect(page.locator('h1').first()).toBeAttached()
  await page.evaluate(async () => {
    await document.fonts.ready
    // Uma transição interrompida (hover, foco que muda) rejeita o `finished`: também terminou.
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    )
  })
}

/** Roda o axe e falha com a lista legível das violações (regra, impacto e alvos). */
async function expectNoViolations(page: Page, testInfo: TestInfo): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(WCAG_22_AA)
  for (const exception of EXCEPTIONS) builder = builder.exclude(exception.selector)
  const results = await builder.analyze()
  if (results.violations.length > 0) {
    // Em arquivo no diretório do teste, que o job publica como artifact na falha.
    const path = testInfo.outputPath(`axe-${testInfo.attachments.length}.json`)
    await writeFile(path, JSON.stringify(results.violations, null, 2))
    await testInfo.attach('axe-violations', { path, contentType: 'application/json' })
  }
  const summary = results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.html),
  }))
  expect(summary).toEqual([])
}

for (const locale of ['en', 'pt-BR'] as const) {
  for (const theme of THEMES) {
    test.describe(`axe ${locale} ${theme}`, () => {
      test.use({ locale, colorScheme: theme })

      test.beforeEach(async ({ page }) => {
        // O tema explícito, como o seletor grava, antes do script de inicialização do documento.
        await page.addInitScript((value) => {
          localStorage.setItem('teko-theme', value)
        }, theme)
      })

      for (const route of ROUTES) {
        test(route.name, async ({ page, context, baseURL }, testInfo) => {
          if (route.session) await signInWithTestSession(context, baseURL)
          await page.goto(`/${locale}/${route.path}`)
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
          await settled(page)
          await expectNoViolations(page, testInfo)
        })
      }

      test('landing com a demonstração no meio da resposta', async ({ page }, testInfo) => {
        await page.goto(`/${locale}/`)
        const demo = page.getByTestId('hero-demo')
        // A demonstração recomeça sozinha; o axe roda com a resposta chegando em stream.
        await expect(demo).toHaveAttribute('data-phase', 'streaming', { timeout: 15_000 })
        await settled(page)
        await expectNoViolations(page, testInfo)
      })

      test('chat com resposta e o painel de citação aberto', async ({
        page,
        context,
        baseURL,
        isMobile,
      }, testInfo) => {
        const chat = MESSAGES[locale].chat
        await signInWithTestSession(context, baseURL)
        await page.goto(`/${locale}/chat/?ref=2008-05`)
        await settled(page)
        const composer = page.getByRole('textbox', { name: chat.composer.label })
        await composer.fill('O que diz o art. 76, § 6º do RCTE?')
        await composer.press('ControlOrMeta+Enter')

        const answer = page.locator('article[data-message-role="assistant"]').last()
        const chip = answer.locator('[data-answer-body] button[data-citation-id="S1"]')
        await expect(chip).toBeVisible()
        await expect(answer).toHaveAttribute('aria-busy', 'false')
        await settled(page)
        await expectNoViolations(page, testInfo)

        await chip.click()
        const scope = isMobile ? page.getByRole('dialog') : page.locator('body')
        await expect(scope.getByRole('link', { name: chat.citation.source })).toBeVisible()
        await settled(page)
        await expectNoViolations(page, testInfo)

        // O que mudou, no próprio painel (a primeira fonte pode não ter redação anterior).
        const toggle = scope.getByRole('button', { name: MESSAGES[locale].provision.showDiff })
        if (await toggle.isVisible()) {
          await toggle.click()
          await expect(scope.locator('ins, del').first()).toBeVisible()
          await settled(page)
          await expectNoViolations(page, testInfo)
        }
      })

      test('entrada: criar conta com os erros dos campos', async ({ page }, testInfo) => {
        const email = MESSAGES[locale].auth.email
        await page.goto(`/${locale}/sign-in/`)
        await settled(page)
        await page.getByRole('tab', { name: email.signUp }).click()
        await page.getByLabel(email.password, { exact: true }).fill('curta')
        await page.getByRole('button', { name: email.submitSignUp }).click()
        await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible()
        await settled(page)
        await expectNoViolations(page, testInfo)
      })

      test('onboarding com o seletor de país aberto', async ({
        page,
        context,
        baseURL,
      }, testInfo) => {
        const onboarding = MESSAGES[locale].onboarding
        await signInWithTestSession(context, baseURL)
        // O usuário de teste já concluiu o onboarding: o `/me` simula a pendência.
        await page.route('**/api/v1/me', async (route) => {
          const response = await route.fetch()
          const me = (await response.json()) as { onboarding: Record<string, unknown> }
          await route.fulfill({
            response,
            json: { ...me, onboarding: { ...me.onboarding, required: true } },
          })
        })
        await page.goto(`/${locale}/settings/`)
        await settled(page)
        await page
          .getByRole('button', { name: MESSAGES[locale].settings.account.completeOnboarding })
          .click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        await settled(page)
        await expectNoViolations(page, testInfo)
        await dialog.getByRole('combobox', { name: onboarding.country }).click()
        await expect(page.getByPlaceholder(onboarding.countrySearch)).toBeVisible()
        await settled(page)
        await expectNoViolations(page, testInfo)
      })

      test.describe('primeira visita', () => {
        // Sem a escolha de consentimento: o banner LGPD na tela.
        test.use({ storageState: { cookies: [], origins: [] } })

        test('banner de consentimento e preferências', async ({ page }, testInfo) => {
          const consent = MESSAGES[locale].consent
          await page.goto(`/${locale}/`)
          const banner = page.getByTestId('consent-banner')
          await expect(banner).toBeVisible()
          await settled(page)
          await expectNoViolations(page, testInfo)

          await banner.getByRole('button', { name: consent.banner.customize, exact: true }).click()
          await expect(page.getByRole('dialog', { name: consent.preferences.title })).toBeVisible()
          await settled(page)
          await expectNoViolations(page, testInfo)
        })
      })
    })
  }
}
