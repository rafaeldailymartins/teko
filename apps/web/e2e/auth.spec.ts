import { readFile } from 'node:fs/promises'
import { expect, type Page, test } from '@playwright/test'
import ptBR from '../messages/pt-BR.json' with { type: 'json' }
import { enforcedViolations, recordViolations, signInWithTestSession } from './support.ts'

/**
 * Jornadas de autenticação e conta (mudança `add-auth-ui`) na stack de CI. O OAuth real não roda
 * aqui (a stack não tem OAuth apps): a jornada vai até o redirect para `/api/auth/...`. A sessão de
 * teste é compartilhada pelos workers, então nenhuma jornada sai nem exclui a conta de verdade.
 */
test.use({ locale: 'pt-BR' })

const OAUTH_REDIRECT = '/api/auth/e2e-oauth-redirect'

/** Simula o início do OAuth (o Better Auth responderia com a URL do provedor) e guarda o corpo. */
async function interceptSocialSignIn(page: Page, baseURL: string | undefined) {
  const origin = new URL(baseURL ?? 'http://localhost:8080').origin
  const bodies: unknown[] = []
  await page.route('**/api/auth/sign-in/social', async (route) => {
    bodies.push(route.request().postDataJSON())
    await route.fulfill({ json: { url: `${origin}${OAUTH_REDIRECT}`, redirect: true } })
  })
  await page.route(`**${OAUTH_REDIRECT}`, (route) =>
    route.fulfill({ body: 'provedor OAuth', contentType: 'text/plain' }),
  )
  return bodies
}

test.describe('sem sessão', () => {
  test('o chat manda para a entrada com o retorno, sem violação de CSP', async ({ page }) => {
    await recordViolations(page)
    await page.goto('/pt-BR/chat/?ref=2024-03')
    await expect(page).toHaveURL(
      /\/pt-BR\/sign-in\/\?callbackURL=%2Fpt-BR%2Fchat%2F%3Fref%3D2024-03$/,
    )
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible()
    await expect(page.getByRole('button', { name: ptBR.auth.signIn.github })).toBeVisible()
    await expect(page.getByRole('button', { name: ptBR.auth.signIn.google })).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(await enforcedViolations(page)).toEqual([])
  })

  test('o GitHub segue para /api/auth com o retorno da página de origem', async ({
    page,
    baseURL,
  }) => {
    const bodies = await interceptSocialSignIn(page, baseURL)
    await page.goto('/pt-BR/sign-in/?callbackURL=%2Fpt-BR%2Fhistory%2F')
    await page.getByRole('button', { name: ptBR.auth.signIn.github }).click()
    await page.waitForURL(`**${OAUTH_REDIRECT}`)
    expect(bodies).toEqual([
      {
        provider: 'github',
        callbackURL: '/pt-BR/history/',
        errorCallbackURL: '/pt-BR/sign-in/?callbackURL=%2Fpt-BR%2Fhistory%2F',
      },
    ])
  })

  test('um retorno para outra origem é descartado (sem open redirect)', async ({
    page,
    baseURL,
  }) => {
    const bodies = await interceptSocialSignIn(page, baseURL)
    await page.goto('/pt-BR/sign-in/?callbackURL=https%3A%2F%2Fevil.example%2F')
    await page.getByRole('button', { name: ptBR.auth.signIn.google }).click()
    await page.waitForURL(`**${OAUTH_REDIRECT}`)
    expect(bodies).toEqual([
      {
        provider: 'google',
        callbackURL: '/pt-BR/chat/',
        errorCallbackURL: '/pt-BR/sign-in/?callbackURL=%2Fpt-BR%2Fchat%2F',
      },
    ])
  })

  test('o erro do callback vira mensagem, e region_restricted vira aviso', async ({ page }) => {
    await page.goto('/pt-BR/sign-in/?error=access_denied')
    await expect(page.getByRole('alert')).toContainText(ptBR.auth.errors.cancelled)
    await page.goto('/pt-BR/sign-in/?error=region_restricted')
    await expect(
      page.getByRole('heading', { level: 1, name: ptBR.auth.region.title }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: ptBR.auth.signIn.github })).toBeHidden()
  })
})

test.describe('com sessão', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signInWithTestSession(context, baseURL)
  })

  test('o cabeçalho mostra a sessão e as configurações abrem', async ({ page }) => {
    await recordViolations(page)
    await page.goto('/pt-BR/chat/')
    const account = page.getByRole('button', { name: 'Conta de E2E' })
    await account.click()
    await expect(page.getByRole('menuitem', { name: ptBR.auth.menu.signOut })).toBeVisible()
    await page.getByRole('menuitem', { name: ptBR.auth.menu.settings }).click()
    await expect(page).toHaveURL(/\/pt-BR\/settings\/$/)
    await expect(page.getByText('e2e@teko.localhost')).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 2, name: ptBR.settings.quota.title }),
    ).toBeVisible()
    await expect(page.getByText(/\d+ de \d+ perguntas hoje/)).toBeVisible()
    await expect(page.getByText(ptBR.settings.passkeys.empty)).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(await enforcedViolations(page)).toEqual([])
  })

  test('exportar baixa um JSON com os dados da conta', async ({ page }) => {
    await page.goto('/pt-BR/settings/')
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: ptBR.settings.data.export }).click()
    const download = await downloading
    expect(download.suggestedFilename()).toBe('teko-meus-dados.json')
    const data = JSON.parse(await readFile(await download.path(), 'utf8')) as {
      user: { email: string }
    }
    expect(data.user.email).toBe('e2e@teko.localhost')
    await expect(page.getByText(ptBR.settings.data.exported)).toBeVisible()
  })

  test('excluir a conta pede a palavra digitada (e aqui se cancela)', async ({ page }) => {
    await page.goto('/pt-BR/settings/')
    await page.getByRole('button', { name: ptBR.settings.delete.button }).click()
    const dialog = page.getByRole('dialog', { name: ptBR.settings.delete.title })
    const confirm = dialog.getByRole('button', { name: ptBR.settings.delete.confirm })
    await expect(confirm).toBeDisabled()
    await dialog.getByRole('textbox').fill(ptBR.settings.delete.word)
    await expect(confirm).toBeEnabled()
    await dialog.getByRole('button', { name: ptBR.settings.delete.cancel }).click()
    await expect(dialog).toBeHidden()
  })

  test('o onboarding pendente bloqueia o app até o aceite', async ({ page }) => {
    // O usuário de teste já concluiu o onboarding: o `/me` simula a pendência até o envio.
    let accepted = false
    await page.route('**/api/v1/me', async (route) => {
      const response = await route.fetch()
      const me = (await response.json()) as { onboarding: Record<string, unknown> }
      const onboarding = accepted
        ? me.onboarding
        : { ...me.onboarding, required: true, acceptedTermsVersion: null }
      await route.fulfill({ response, json: { ...me, onboarding } })
    })
    // O envio vai para a API de verdade, com os mesmos valores que o usuário de teste já tem.
    await page.route('**/api/v1/me/onboarding', async (route) => {
      accepted = true
      await route.continue()
    })
    await page.goto('/pt-BR/chat/')
    const dialog = page.getByRole('dialog', { name: ptBR.onboarding.title })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('checkbox', { name: ptBR.onboarding.adult }).check()
    await dialog.getByRole('checkbox', { name: /Termos de uso/ }).check()
    await expect(dialog.getByRole('combobox', { name: ptBR.onboarding.country })).toHaveValue('BR')
    await dialog.getByRole('button', { name: ptBR.onboarding.submit }).click()
    await expect(dialog).toBeHidden()
  })
})
