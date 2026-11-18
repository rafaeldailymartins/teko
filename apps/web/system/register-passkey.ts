/**
 * Registra a passkey do usuário de teste do staging e escreve a credencial (JSON) no stdout, para
 * o segredo `SYSTEM_TEST_PASSKEY` do environment `staging` (runbook `docs/runbooks/system-test.md`).
 * O mantenedor roda na máquina dele, num terminal interativo, a partir da raiz do repositório:
 *
 *   node apps/web/system/register-passkey.ts | gh secret set SYSTEM_TEST_PASSKEY --env staging
 *
 * O que faz: abre o staging num Chromium sem interface com um autenticador virtual (CDP), entra
 * na conta de teste já existente com e-mail e senha lidos do terminal (nunca de argumento nem de
 * variável de ambiente), cadastra a passkey nas configurações pela tela real, exporta a credencial
 * do autenticador (`WebAuthn.getCredentials`) e confere que ela entra sozinha, num contexto novo,
 * antes de escrever. Tudo o que não é a credencial vai para o stderr; o stdout recebe só o JSON.
 * Não aceita argumentos.
 */
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { chromium } from '@playwright/test'
import { consentDecided } from '../e2e/support/consent-state.ts'
import ptBR from '../messages/pt-BR.json' with { type: 'json' }
import {
  addVirtualAuthenticator,
  exportPasskey,
  importPasskey,
  STAGING_ORIGIN,
} from './support/passkey.ts'

/** Nome da passkey na lista das configurações (para achar e remover numa rotação). */
const PASSKEY_NAME = 'system test (CI)'

const say = (line: string) => process.stderr.write(`${line}\n`)

async function readLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true })
  try {
    return (await rl.question(prompt)).trim()
  } finally {
    rl.close()
  }
}

/** Lê a senha sem eco (modo raw do TTY). */
function readSecret(prompt: string): Promise<string> {
  const stdin = process.stdin
  process.stderr.write(prompt)
  stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding('utf8')
  return new Promise((done, fail) => {
    let value = ''
    const finish = (error?: Error) => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      process.stderr.write('\n')
      if (error === undefined) {
        done(value)
      } else {
        fail(error)
      }
    }
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish()
          return
        }
        if (char === '\u0003') {
          finish(new Error('cancelado'))
          return
        }
        value = char === '\u007f' || char === '\b' ? value.slice(0, -1) : value + char
      }
    }
    stdin.on('data', onData)
  })
}

async function main(): Promise<void> {
  if (process.argv.length > 2) {
    throw new Error('sem argumentos: e-mail e senha são lidos do terminal')
  }
  if (!process.stdin.isTTY) {
    throw new Error('rode num terminal interativo (o e-mail e a senha são lidos do TTY)')
  }
  if (process.stdout.isTTY) {
    say('Aviso: o stdout é o terminal; a credencial vai aparecer na tela. Use o pipe do runbook.')
  }
  say(`Conta de teste do staging (${STAGING_ORIGIN}); o cadastro dela é feito antes, pela tela.`)
  const email = await readLine('E-mail: ')
  const password = await readSecret('Senha: ')
  if (email === '' || password === '') {
    throw new Error('e-mail e senha são obrigatórios')
  }

  const browser = await chromium.launch()
  try {
    const options = {
      baseURL: STAGING_ORIGIN,
      locale: 'pt-BR',
      storageState: consentDecided(STAGING_ORIGIN),
    }
    const context = await browser.newContext(options)
    const page = await context.newPage()
    const authenticator = await addVirtualAuthenticator(context, page)

    say('Entrando com e-mail e senha…')
    await page.goto('/pt-BR/sign-in/?callbackURL=%2Fpt-BR%2Fsettings%2F')
    await page.getByLabel(ptBR.auth.email.email, { exact: true }).fill(email)
    await page.getByLabel(ptBR.auth.email.password, { exact: true }).fill(password)
    await page.getByRole('button', { name: ptBR.auth.email.submitSignIn, exact: true }).click()
    await page.waitForURL(/\/pt-BR\/settings\/$/, { timeout: 30_000 })
    if (await page.getByRole('dialog', { name: ptBR.onboarding.title }).isVisible()) {
      throw new Error(
        'a conta de teste ainda não concluiu o onboarding: conclua pela tela e rode de novo',
      )
    }

    say('Cadastrando a passkey nas configurações…')
    await page.getByLabel(ptBR.settings.passkeys.nameLabel).fill(PASSKEY_NAME)
    await page.getByRole('button', { name: ptBR.settings.passkeys.add }).click()
    await page.getByText(ptBR.settings.passkeys.added).waitFor({ timeout: 30_000 })
    const passkey = await exportPasskey(authenticator)
    await context.close()

    say('Conferindo a entrada só com a passkey exportada, num contexto novo…')
    const check = await browser.newContext(options)
    const checkPage = await check.newPage()
    await importPasskey(await addVirtualAuthenticator(check, checkPage), passkey)
    await checkPage.goto('/pt-BR/sign-in/?callbackURL=%2Fpt-BR%2Fchat%2F')
    await checkPage.getByRole('button', { name: ptBR.auth.signIn.passkey }).click()
    await checkPage.waitForURL(/\/pt-BR\/chat\/$/, { timeout: 30_000 })
    await check.close()

    process.stdout.write(`${JSON.stringify(passkey)}\n`)
    say('Pronto: a credencial foi para o stdout.')
  } finally {
    await browser.close()
  }
}

try {
  await main()
} catch (error) {
  say(`register-passkey: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
