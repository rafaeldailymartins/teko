import { randomUUID } from 'node:crypto'
import { type Browser, expect, test } from '@playwright/test'
import ptBR from '../messages/pt-BR.json' with { type: 'json' }
import {
  addVirtualAuthenticator,
  exportPasskey,
  importPasskey,
  type StoredPasskey,
} from '../system/support/passkey.ts'
import { completeOnboarding, deleteAccount } from './support/accounts.ts'
import { consentDecided } from './support/consent-state.ts'

/**
 * Passkey pela tela com o autenticador virtual do Chromium (CDP `WebAuthn`), na stack de CI
 * (`rpID` `localhost`). É o mesmo caminho do system test do staging (`system/`): cadastrar nas
 * configurações, exportar a credencial (`WebAuthn.getCredentials`), importá-la num navegador novo
 * (`WebAuthn.addCredential`) e entrar só com ela, inclusive num "run" seguinte com o contador que
 * a importação calcula. A conta é própria (cadastro por e-mail) e sai no fim; um cadastro e nenhuma
 * entrada por senha por tentativa, só no desktop, por causa do rate limit por IP do Better Auth.
 */
test.use({ locale: 'pt-BR' })

const RP_ID = 'localhost'

async function signInWithPasskey(
  browser: Browser,
  baseURL: string,
  passkey: StoredPasskey,
  nowMs: number,
): Promise<void> {
  const context = await browser.newContext({
    baseURL,
    locale: 'pt-BR',
    storageState: consentDecided(baseURL),
  })
  try {
    const page = await context.newPage()
    await importPasskey(await addVirtualAuthenticator(context, page), passkey, nowMs)
    await page.goto('/pt-BR/sign-in/?callbackURL=%2Fpt-BR%2Fchat%2F')
    await page.getByRole('button', { name: ptBR.auth.signIn.passkey }).click()
    await expect(page).toHaveURL(/\/pt-BR\/chat\/$/)
    expect((await page.request.get('/api/v1/me')).status()).toBe(200)
  } finally {
    await context.close()
  }
}

test('cadastra a passkey, exporta e entra só com ela em outro navegador', async ({
  page,
  context,
  browser,
  baseURL,
  isMobile,
}) => {
  test.skip(isMobile, 'uma jornada só, por causa do rate limit por IP')
  const base = baseURL ?? 'http://localhost:8080'
  const authenticator = await addVirtualAuthenticator(context, page)

  await page.goto('/pt-BR/sign-in/')
  await page.getByRole('tab', { name: ptBR.auth.email.signUp }).click()
  await page.getByLabel(ptBR.auth.email.name, { exact: true }).fill('Conta de E2E da passkey')
  await page
    .getByLabel(ptBR.auth.email.email, { exact: true })
    .fill(`e2e-passkey-${randomUUID()}@teko.localhost`)
  await page.getByLabel(ptBR.auth.email.password, { exact: true }).fill('uma senha longa de teste')
  await page.getByRole('button', { name: ptBR.auth.email.submitSignUp }).click()
  await completeOnboarding(page)

  await page.goto('/pt-BR/settings/')
  await expect(page.getByText(ptBR.settings.passkeys.empty)).toBeVisible()
  await page.getByLabel(ptBR.settings.passkeys.nameLabel).fill('system test (CI)')
  await page.getByRole('button', { name: ptBR.settings.passkeys.add }).click()
  // Texto exato: "Passkey cadastrada." também é trecho de "Nenhuma passkey cadastrada.".
  await expect(page.getByText(ptBR.settings.passkeys.added, { exact: true })).toBeVisible()
  await expect(page.getByText('system test (CI)', { exact: true })).toBeVisible()

  const passkey = await exportPasskey(authenticator, RP_ID)
  expect(passkey.rpId).toBe(RP_ID)

  // Dois "runs" do system test a partir do mesmo segredo: o contador importado cresce com o tempo.
  const now = Date.now()
  await signInWithPasskey(browser, base, passkey, now)
  await signInWithPasskey(browser, base, passkey, now + 60_000)

  await deleteAccount(page)
})
