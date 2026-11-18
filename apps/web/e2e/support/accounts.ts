import { expect, type Page } from '@playwright/test'
import ptBR from '../../messages/pt-BR.json' with { type: 'json' }

/*
 * Passos de conta pela tela, para as jornadas que criam uma conta própria (a sessão de teste da
 * stack é compartilhada e não pode sair nem ser excluída): o onboarding bloqueante de uma conta
 * nova e a exclusão da conta no fim.
 */

/** Conclui o onboarding que abre no chat de uma conta nova (18+, Termos e país padrão). */
export async function completeOnboarding(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/pt-BR\/chat\/$/)
  const onboarding = page.getByRole('dialog', { name: ptBR.onboarding.title })
  await expect(onboarding).toBeVisible()
  await onboarding.getByRole('checkbox', { name: ptBR.onboarding.adult }).check()
  await onboarding.getByRole('checkbox', { name: /Termos de uso/ }).check()
  await expect(onboarding.getByRole('combobox', { name: ptBR.onboarding.country })).toContainText(
    'Brasil',
  )
  await onboarding.getByRole('button', { name: ptBR.onboarding.submit }).click()
  await expect(onboarding).toBeHidden()
  await expect(page.getByRole('textbox', { name: 'Sua pergunta' })).toBeEnabled()
}

/** Na página de configurações, exclui a conta da sessão e confere que a sessão acabou. */
export async function deleteAccount(page: Page): Promise<void> {
  await page.getByRole('button', { name: ptBR.settings.delete.button }).click()
  const removal = page.getByRole('dialog', { name: ptBR.settings.delete.title })
  await removal.getByRole('textbox').fill(ptBR.settings.delete.word)
  await removal.getByRole('button', { name: ptBR.settings.delete.confirm }).click()
  await expect(page).toHaveURL(/\/pt-BR\/$/)
  expect((await page.request.get('/api/v1/me')).status()).toBe(401)
}
