import { expect, test } from '@playwright/test'
import en from '../messages/en.json' with { type: 'json' }
import ptBR from '../messages/pt-BR.json' with { type: 'json' }
import { enforcedViolations, recordViolations } from './support/csp.ts'

/**
 * Landing: a demonstração animada do chat (estática, sem API) roda sozinha, pausa no botão,
 * respeita o movimento reduzido e tem um resumo para leitor de tela; as seções novas estão lá e
 * nada viola a CSP.
 */

test.describe('demonstração do hero', () => {
  test('anima a pergunta e a resposta, com o resumo acessível e sem violar a CSP', async ({
    page,
  }) => {
    await recordViolations(page)
    await page.goto('/pt-BR/')
    const demo = page.getByTestId('hero-demo')
    await expect(demo).toBeVisible()
    // O HTML estático e o primeiro quadro: as duas respostas completas.
    await expect(demo).toHaveAttribute('data-phase', 'answered')

    const window = page.getByTestId('hero-demo-window')
    await expect(window).toHaveAttribute('aria-hidden', 'true')
    const summary = page.getByTestId('hero-demo-summary')
    await expect(summary).toContainText('05/2008')
    await expect(summary).toContainText('01/2010')
    await expect(summary).toContainText('23/11/2009')
    await expect(page.getByRole('figure', { name: ptBR.landing.demo.caption })).toBeVisible()

    // Recomeça sozinha: digita a pergunta e mostra o chip da data de referência.
    await expect(demo).toHaveAttribute('data-phase', 'typing', { timeout: 10_000 })
    await expect(window.locator('[data-demo-chip="0"]')).toBeVisible({ timeout: 10_000 })
    await expect(window.locator('[data-demo-exchange="0"]')).toContainText('40.000,00', {
      timeout: 15_000,
    })
    // O ponto âmbar da linha do tempo acompanha a cena (05/2008).
    await expect(demo).toHaveAttribute('data-reference', '0')
    await expect(page.getByTestId('hero-timeline-date')).toHaveText('05/2008')

    await page.waitForLoadState('networkidle')
    expect(await enforcedViolations(page)).toEqual([])
  })

  test('o botão pausa e retoma a demonstração', async ({ page }) => {
    await page.goto('/pt-BR/')
    const demo = page.getByTestId('hero-demo')
    await expect(demo).toHaveAttribute('data-phase', 'typing', { timeout: 10_000 })
    const pause = page.getByRole('button', { name: ptBR.landing.demo.pause })
    await pause.click()
    const resume = page.getByRole('button', { name: ptBR.landing.demo.play })
    await expect(resume).toBeVisible()
    const frozen = await page.getByTestId('hero-demo-window').textContent()
    await page.waitForTimeout(1500)
    expect(await page.getByTestId('hero-demo-window').textContent()).toBe(frozen)
    await resume.click()
    await expect(page.getByRole('button', { name: ptBR.landing.demo.pause })).toBeVisible()
    await expect
      .poll(() => page.getByTestId('hero-demo-window').textContent(), { timeout: 5000 })
      .not.toBe(frozen)
  })

  test.describe('com movimento reduzido', () => {
    test.use({ reducedMotion: 'reduce' })

    test('mostra o estado final, sem digitação nem botão de pausa', async ({ page }) => {
      await page.goto('/en/')
      const demo = page.getByTestId('hero-demo')
      await expect(demo).toHaveAttribute('data-phase', 'answered')
      await page.waitForTimeout(4000)
      await expect(demo).toHaveAttribute('data-phase', 'answered')
      await expect(demo.locator('[data-demo-exchange]')).toHaveCount(2)
      await expect(page.getByRole('button', { name: en.landing.demo.pause })).toHaveCount(0)
      await expect(page.getByTestId('hero-timeline-date')).toHaveText('01/2010')
    })
  })
})

test('a landing tem as seções novas e a faixa final leva ao app', async ({ page }) => {
  await page.goto('/pt-BR/')
  for (const id of [
    'how-it-works-title',
    'corpus-title',
    'guarantees-title',
    'faq-title',
    'final-cta-title',
  ]) {
    await expect(page.locator(`#${id}`)).toBeVisible()
  }
  await expect(page.locator('#corpus-title').locator('xpath=ancestor::section')).toContainText(
    ptBR.landing.corpus.rcte.name,
  )
  const band = page.locator('section[aria-labelledby="final-cta-title"]')
  await expect(band.getByRole('link', { name: ptBR.landing.cta.open })).toHaveAttribute(
    'href',
    '/pt-BR/chat/',
  )
})

test('o FAQ abre uma pergunta por vez', async ({ page }) => {
  await page.goto('/pt-BR/')
  const faq = page.locator('section[aria-labelledby="faq-title"]')
  await faq.getByText(ptBR.landing.faq.advice.question).click()
  await expect(faq.getByText(ptBR.landing.faq.advice.answer)).toBeVisible()
  await faq.getByText(ptBR.landing.faq.cost.question).click()
  await expect(faq.getByText(ptBR.landing.faq.cost.answer)).toBeVisible()
  await expect(faq.getByText(ptBR.landing.faq.advice.answer)).toBeHidden()
})
