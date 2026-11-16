import { expect, type Locator, type Page, test } from '@playwright/test'
import { enforcedViolations, recordViolations } from './support/csp.ts'
import { signInWithTestSession } from './support/session.ts'

/**
 * Jornadas do chat na stack de CI (estático e API na mesma origem, LLM e embeddings fake, sessão de
 * teste em `E2E_SESSION_COOKIE`). O LLM fake responde "Conforme as fontes [S1] e [S2], ..." citando
 * as fontes recuperadas; o que muda entre datas são a data resolvida, as citações e as vigências.
 *
 * Fixture (`apps/api/test/fixtures/corpus/documents/rcte.json`), RCTE, art. 76, § 6º:
 * - [2004-11-04, 2009-11-23): piso de 40.000 no GOYAZES/PROESPORTE (vale em 05/2008);
 * - [2009-11-23, ∞): "Revogado." pelo Decreto nº 7.028 (vale em 01/2010).
 */

const QUESTION = 'O que diz o art. 76, § 6º do RCTE?'

/** Chip do § 6º (no texto ou na lista de fontes), sem os incisos ("§ 6º, I"). */
const SIXTH_PARAGRAPH = /^Fonte \d+: RCTE, art\. 76, § 6º$/

async function ask(page: Page, question: string): Promise<void> {
  const composer = page.getByRole('textbox', { name: 'Sua pergunta' })
  await composer.fill(question)
  await composer.press('ControlOrMeta+Enter')
}

/** Abre a citação do chip e devolve o painel (painel direito no desktop, Drawer no celular). */
async function openCitation(page: Page, chip: Locator, isMobile: boolean): Promise<Locator> {
  await chip.click()
  const scope = isMobile ? page.getByRole('dialog') : page.locator('body')
  const panel = scope.locator('article').filter({ hasText: /Citação \d+ de \d+/ })
  await expect(panel).toBeVisible()
  return panel
}

/**
 * Chip do § 6º numa resposta pronta: no texto ou na lista de fontes, que fica recolhida numa linha
 * ("N fontes") até ser aberta.
 */
async function sixthParagraphChip(answer: Locator): Promise<Locator> {
  await expect(answer).toHaveAttribute('aria-busy', 'false')
  const sources = answer.getByRole('button', { name: /^\d+ fontes?$/ })
  if ((await sources.getAttribute('aria-expanded')) === 'false') await sources.click()
  return answer.getByRole('button', { name: SIXTH_PARAGRAPH }).first()
}

/** Fecha a citação com `Esc` (o foco está no chip ou no painel): o painel ou o Drawer some. */
async function closeCitation(page: Page, isMobile: boolean): Promise<void> {
  await page.keyboard.press('Escape')
  if (isMobile) {
    await expect(page.getByRole('dialog')).toBeHidden()
  } else {
    await expect(page.locator('[data-citation-panel]')).toHaveCount(0)
  }
}

test.use({ locale: 'pt-BR' })

test.describe('chat', () => {
  test.beforeEach(async ({ context, page, baseURL }) => {
    // Sessão de teste no navegador; troca direta pelo helper comum de sessão dos e2e quando existir.
    await signInWithTestSession(context, baseURL)
    await recordViolations(page)
  })

  test('chat vazio: a data só no chip e sugestões sem repetir', async ({ page }) => {
    await page.goto('/pt-BR/chat/?ref=2008-05')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      /^(Bom dia|Boa tarde|Boa noite)/,
    )
    // A data de referência aparece uma vez só: no chip do composer, que abre o seletor.
    const chip = page.locator('[data-reference-chip]')
    await expect(chip).toContainText('05/2008')
    await expect(page.locator('[data-chat-welcome]')).not.toContainText('05/2008')
    const questions = await page.locator('[data-suggestion] [lang="pt-BR"]').allTextContents()
    expect(questions).toHaveLength(4)
    expect(new Set(questions).size).toBe(4)
    await expect(page.getByText('Apoio à consulta; não constitui parecer.')).toBeInViewport()

    await chip.click()
    await expect(page.locator('[data-slot="popover-content"]')).toBeVisible()
    await page.keyboard.press('Escape')

    // Uma sugestão de família pergunta no período dela e leva o foco ao composer.
    await page.getByRole('button', { name: /registro C170/ }).click()
    await expect(page).toHaveURL(/ref=2025-06/)
    await expect(page.getByRole('textbox', { name: 'Sua pergunta' })).toBeFocused()
    await expect(
      page.locator('article[data-message-role="assistant"] [data-reference-date]'),
    ).toHaveAttribute('data-reference-date', '2025-06-01')
  })

  test('pergunta com stream e chip de citação abrindo o painel', async ({ page, isMobile }) => {
    await page.goto('/pt-BR/chat/?ref=2006-05')
    await expect(page.locator('[data-reference-chip]')).toContainText(
      'Período de apuração: 05/2006',
    )
    // Sufixo único: fora do cache de respostas, a pergunta sai pelo stream.
    await ask(page, `Qual valor mínimo aplicado no GOYAZES? (e2e ${Date.now().toString(36)})`)

    await expect(page.getByTestId('chat-live')).toHaveText('Gerando a resposta.')
    const answer = page.locator('article[data-message-role="assistant"]').last()
    await expect(answer.locator('[data-reference-date]')).toHaveAttribute(
      'data-reference-date',
      '2006-05-01',
    )
    const chip = answer.locator('[data-answer-body] button[data-citation-id="S1"]')
    await expect(chip).toBeVisible()
    await expect(page.getByTestId('chat-live')).toHaveText('Resposta pronta.')
    await expect(answer).toHaveAttribute('aria-busy', 'false')

    const panel = await openCitation(page, chip, isMobile)
    await expect(panel.locator('[data-validity]')).toBeVisible()
    await expect(panel.locator('blockquote[lang="pt-BR"]')).toBeVisible()
    await expect(panel.getByRole('link', { name: 'Abrir a fonte oficial' })).toHaveAttribute(
      'href',
      /^https:\/\//,
    )
    await closeCitation(page, isMobile)

    await page.waitForLoadState('networkidle')
    expect(await enforcedViolations(page)).toEqual([])
  })

  test('a mesma pergunta em 05/2008 e em 01/2010 muda a resposta, a citação e o intervalo', async ({
    page,
    isMobile,
  }) => {
    await page.goto('/pt-BR/chat/')
    // Sugestão sensível à data do chat vazio: a pergunta do DoD em 05/2008.
    await page.getByRole('button', { name: 'Perguntar em 05/2008' }).click()
    const first = page.locator('article[data-message-role="assistant"]').first()
    await expect(first.locator('[data-reference-date]')).toHaveAttribute(
      'data-reference-date',
      '2008-05-01',
    )
    await expect(page.locator('[data-reference-chip]')).toContainText('05/2008')
    const firstChip = await sixthParagraphChip(first)
    await expect(firstChip).toBeVisible()
    const firstValidity = await first.locator('[data-answer-validity]').textContent()

    let panel = await openCitation(page, firstChip, isMobile)
    await expect(panel.locator('h3')).toHaveText('RCTE, art. 76, § 6º')
    await expect(panel.locator('[data-validity]')).toContainText('04/11/2004 a 22/11/2009')
    await expect(panel.locator('blockquote')).toContainText('GOYAZES')
    await closeCitation(page, isMobile)

    // Troca o chip para 01/2010 pelo seletor (Alt+D) e repete a pergunta.
    await page.keyboard.press('Alt+d')
    const picker = page.locator('[data-slot="popover-content"]')
    await expect(picker).toBeVisible()
    await picker.getByRole('button', { name: 'Próximo ano' }).click()
    await picker.getByRole('button', { name: 'Próximo ano' }).click()
    await picker.locator('button[data-periodo="2010-01"]').click()
    await expect(page.locator('[data-reference-chip]')).toContainText('01/2010')
    await expect(page).toHaveURL(/ref=2010-01/)
    await ask(page, QUESTION)

    const second = page.locator('article[data-message-role="assistant"]').nth(1)
    await expect(second.locator('[data-reference-date]')).toHaveAttribute(
      'data-reference-date',
      '2010-01-01',
    )
    const secondChip = await sixthParagraphChip(second)
    await expect(secondChip).toBeVisible()
    expect(await second.locator('[data-answer-validity]').textContent()).not.toBe(firstValidity)

    panel = await openCitation(page, secondChip, isMobile)
    await expect(panel.locator('h3')).toHaveText('RCTE, art. 76, § 6º')
    await expect(panel.locator('[data-validity]')).toContainText('desde 23/11/2009')
    await expect(panel.locator('blockquote')).toContainText('Revogado')

    // Linha do tempo do § 6º no próprio painel, com a redação de 01/2010 marcada.
    const timeline = panel.getByRole('list', { name: 'Redações do dispositivo' })
    await expect(timeline.getByRole('listitem').nth(1)).toBeVisible()
    expect(await timeline.getByRole('listitem').count()).toBeGreaterThanOrEqual(2)
    await expect(timeline.locator('[aria-current="true"]')).toContainText('desde 23/11/2009')
    await expect(panel.getByRole('link', { name: 'Abrir o dispositivo' })).toHaveAttribute(
      'href',
      /\/pt-BR\/provision\/\?k=go%3Arcte%3Aart%3A76%3Apar%3A6&ref=2010-01-01$/,
    )
    await closeCitation(page, isMobile)

    await page.waitForLoadState('networkidle')
    expect(await enforcedViolations(page)).toEqual([])
  })
})
