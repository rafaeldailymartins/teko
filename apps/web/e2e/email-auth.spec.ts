import { randomUUID } from 'node:crypto'
import { expect, type Page, test } from '@playwright/test'
import ptBR from '../messages/pt-BR.json' with { type: 'json' }
import { completeOnboarding, deleteAccount } from './support/accounts.ts'
import { enforcedViolations, recordViolations } from './support/csp.ts'

/**
 * Login por e-mail e senha (ADR 0036) pela tela, na stack de CI: a stack não tem OAuth apps, então
 * a entrada mostra só a passkey e o e-mail. A jornada cria a conta pela aba "Criar conta", passa
 * pelo onboarding, sai, erra a senha, entra de novo, vê o método nas configurações e exclui a conta.
 *
 * O rate limit do Better Auth conta por IP (5 entradas por minuto, 5 cadastros a cada 10 minutos),
 * e todas as jornadas da stack saem do mesmo IP: este arquivo faz um cadastro e três entradas por
 * tentativa, só no projeto desktop.
 */
test.use({ locale: 'pt-BR' })

const email = ptBR.auth.email

async function fillCredentials(page: Page, address: string, password: string): Promise<void> {
  await page.getByLabel(email.email, { exact: true }).fill(address)
  await page.getByLabel(email.password, { exact: true }).fill(password)
}

test.describe('e-mail e senha pela tela', () => {
  test.skip(({ isMobile }) => isMobile, 'uma jornada só, por causa do rate limit por IP')

  test('a API lista só passkey e e-mail na stack sem OAuth apps', async ({ request }) => {
    const providers = await request.get<unknown>('/api/v1/auth/providers')
    expect(providers.ok()).toBe(true)
    expect(await providers.json()).toEqual({ methods: ['passkey', 'email'] })
  })

  test('cria a conta, conclui o onboarding, entra de novo e exclui a conta', async ({ page }) => {
    const address = `e2e-${randomUUID()}@teko.localhost`
    const password = 'uma senha longa de teste'
    const name = 'Conta de E2E pela tela'
    await recordViolations(page)

    // O app sem sessão leva à entrada, só com os métodos do ambiente.
    await page.goto('/pt-BR/chat/')
    await expect(page).toHaveURL(/\/pt-BR\/sign-in\/\?callbackURL=%2Fpt-BR%2Fchat%2F$/)
    await expect(page.getByRole('button', { name: ptBR.auth.signIn.passkey })).toBeVisible()
    await expect(page.getByRole('button', { name: ptBR.auth.signIn.github })).toBeHidden()
    await expect(page.getByRole('button', { name: ptBR.auth.signIn.google })).toBeHidden()

    // Cadastro: a validação inline segura o envio da senha curta.
    await page.getByRole('tab', { name: email.signUp }).click()
    await page.getByLabel(email.name, { exact: true }).fill(name)
    await fillCredentials(page, address, 'curta')
    await page.getByRole('button', { name: email.submitSignUp }).click()
    await expect(page.getByText('A senha precisa de pelo menos 12 caracteres.')).toBeVisible()
    await page.getByLabel(email.password, { exact: true }).fill(password)
    await page.getByRole('button', { name: email.submitSignUp }).click()

    // Conta nova: o chat abre com o onboarding bloqueante.
    await completeOnboarding(page)

    // Sai pelo menu da conta.
    await page.getByRole('button', { name: `Conta de ${name}` }).click()
    await page.getByRole('menuitem', { name: ptBR.auth.menu.signOut }).click()
    await expect(page).toHaveURL(/\/pt-BR\/$/)

    // Senha errada: a mensagem genérica; a certa entra direto, sem onboarding.
    await page.goto('/pt-BR/sign-in/?callbackURL=%2Fpt-BR%2Fsettings%2F')
    await fillCredentials(page, address, 'uma senha que nao confere')
    await page.getByRole('button', { name: email.submitSignIn, exact: true }).click()
    await expect(
      page.getByRole('alert').filter({ hasText: email.failures.invalidCredentials }),
    ).toBeVisible()
    await page.getByLabel(email.password, { exact: true }).fill(password)
    await page.getByRole('button', { name: email.submitSignIn, exact: true }).click()
    await expect(page).toHaveURL(/\/pt-BR\/settings\/$/)
    await expect(page.getByRole('dialog')).toBeHidden()

    // As configurações mostram o método de entrada; a exclusão apaga a conta e a sessão.
    await expect(page.getByText(ptBR.settings.account.methods.email)).toBeVisible()
    await expect(page.getByText(address)).toBeVisible()
    await deleteAccount(page)

    expect(await enforcedViolations(page)).toEqual([])
  })
})
