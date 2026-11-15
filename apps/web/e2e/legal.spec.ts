import { expect, test } from '@playwright/test'
import { TERMS_VERSION } from '@teko/shared/legal'
import en from '../messages/en.json' with { type: 'json' }
import ptBR from '../messages/pt-BR.json' with { type: 'json' }
import { enforcedViolations, recordViolations } from './support/csp.ts'

/**
 * Páginas legais e "Sobre" nos dois idiomas: título, `lang` do documento, versão dos Termos igual à
 * da API, sumário com âncoras, texto em Source Serif, termos em português marcados com
 * `lang="pt-BR"` na página em inglês, e nenhuma violação de CSP aplicada.
 */

const CATALOGS = { 'pt-BR': ptBR, en } as const

const PAGES = [
  { path: 'privacy', title: (m: typeof ptBR) => m.legal.privacy.title },
  { path: 'terms', title: (m: typeof ptBR) => m.legal.terms.title },
  { path: 'about', title: (m: typeof ptBR) => m.about.title },
] as const

for (const locale of ['pt-BR', 'en'] as const) {
  const messages = CATALOGS[locale]

  test.describe(`páginas legais em ${locale}`, () => {
    for (const { path, title } of PAGES) {
      test(`/${locale}/${path}/ tem título, sumário com âncoras e nenhuma violação de CSP`, async ({
        page,
      }) => {
        await recordViolations(page)
        const response = await page.goto(`/${locale}/${path}/`)
        expect(response?.status()).toBe(200)
        await expect(page.locator('html')).toHaveAttribute('lang', locale)
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(title(messages))

        const toc = page.getByRole('navigation', { name: messages.legal.toc })
        const links = toc.getByRole('link')
        expect(await links.count()).toBeGreaterThan(4)
        // Cada item do sumário aponta para uma seção que existe, com o título do item.
        for (const link of await links.all()) {
          const href = (await link.getAttribute('href')) ?? ''
          expect(href).toMatch(/^#[a-z-]+$/)
          await expect(page.locator(`section${href} h2`)).toHaveText(
            (await link.textContent()) ?? '',
          )
        }

        const last = links.last()
        const target = (await last.getAttribute('href')) ?? ''
        await last.click()
        await expect(page).toHaveURL(new RegExp(`${target}$`))
        await expect(page.locator(`section${target}`)).toBeInViewport()

        const fontFamily = await page
          .locator('section h2')
          .first()
          .evaluate((element) => getComputedStyle(element).fontFamily)
        expect(fontFamily).toMatch(/serif/i)

        await page.waitForLoadState('networkidle')
        expect(await enforcedViolations(page)).toEqual([])
      })
    }

    test(`/${locale}/terms/ mostra a versão dos Termos que a API exige`, async ({ page }) => {
      await page.goto(`/${locale}/terms/`)
      await expect(page.getByTestId('document-version')).toContainText(TERMS_VERSION)
    })
  })
}

test('na página em inglês, os nomes de leis em português ficam com lang="pt-BR"', async ({
  page,
}) => {
  await page.goto('/en/privacy/')
  const term = page.locator('main [lang="pt-BR"]').first()
  await expect(term).toHaveText('Lei Geral de Proteção de Dados Pessoais')
})

test('o rodapé leva às páginas legais', async ({ page }) => {
  await page.goto('/pt-BR/')
  const footer = page.getByRole('contentinfo')
  await footer.getByRole('link', { name: ptBR.pages.privacy.title }).click()
  await expect(page).toHaveURL(/\/pt-BR\/privacy\/$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ptBR.legal.privacy.title)
})
