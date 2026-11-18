import { expect, type Page, type Response, test } from '@playwright/test'
import { SSE_DONE } from '@teko/shared/contracts'
import en from '../messages/en.json' with { type: 'json' }
import ptBR from '../messages/pt-BR.json' with { type: 'json' }
import pool from './questions.json' with { type: 'json' }
import {
  addVirtualAuthenticator,
  importPasskey,
  PASSKEY_SECRET_ENV,
  parsePasskey,
} from './support/passkey.ts'
import {
  outOfCoveragePeriodo,
  parseCoverage,
  parsePool,
  pickPeriodo,
  pickQuestion,
  runNumber,
} from './support/plan.ts'

/**
 * System test do staging (`docs/architecture/ci-cd-e-ambientes.md`, "System test"): o usuário
 * persistente de teste entra por passkey (credencial do segredo `SYSTEM_TEST_PASSKEY` importada num
 * autenticador virtual), faz 1 pergunta do pool (`system/questions.json`, escolhida pelo
 * `GITHUB_RUN_NUMBER`) com o stream até o `finish`, repete a mesma pergunta para conferir o acerto
 * do cache, faz uma pergunta fora da cobertura (recusa sem LLM) e troca o idioma. No máximo 2
 * gerações por run: a primeira pergunta, e a repetição só se o cache falhar (e então o teste
 * reprova). Sem retries (`playwright.system.config.ts`), para não gastar cota com repetições.
 */

/** Resposta do `POST /api/v1/questions` (só o que o teste olha). */
interface AskResponse {
  readonly status: string
  readonly answer?: { readonly meta?: { readonly cached?: boolean } }
  readonly refusal?: { readonly reason?: string }
}

const ASK_PATH = '/api/v1/questions'
const STREAM_PATH = /^\/api\/v1\/questions\/[^/]+\/stream$/

function isAsk(response: Response): boolean {
  return response.request().method() === 'POST' && new URL(response.url()).pathname === ASK_PATH
}

/** Envia a pergunta pelo composer e devolve o JSON do `POST /api/v1/questions`. */
async function ask(page: Page, label: string, question: string): Promise<AskResponse> {
  const answered = page.waitForResponse(isAsk)
  const composer = page.getByRole('textbox', { name: label })
  await composer.fill(question)
  await composer.press('ControlOrMeta+Enter')
  const response = await answered
  expect(response.status(), 'POST /api/v1/questions').toBe(200)
  return (await response.json()) as AskResponse
}

test('passkey, pergunta com stream, cache, recusa fora da cobertura e troca de idioma', async ({
  page,
  context,
  request,
}) => {
  const passkey = parsePasskey(process.env[PASSKEY_SECRET_ENV])
  const run = runNumber(process.env['GITHUB_RUN_NUMBER'])
  const questions = parsePool(pool)
  const question = pickQuestion(questions, run)

  await test.step('entra com a passkey do usuário de teste', async () => {
    const authenticator = await addVirtualAuthenticator(context, page)
    await importPasskey(authenticator, passkey)
    await page.goto('/pt-BR/sign-in/?callbackURL=%2Fpt-BR%2Fchat%2F')
    await page.getByRole('button', { name: ptBR.auth.signIn.passkey }).click()
    await expect(page).toHaveURL(/\/pt-BR\/chat\/$/)
    await expect(page.getByRole('textbox', { name: ptBR.chat.composer.label })).toBeEnabled()
  })

  const coverageResponse = await request.get('/api/v1/coverage')
  expect(coverageResponse.status(), 'GET /api/v1/coverage').toBe(200)
  const coverage = parseCoverage(await coverageResponse.json())
  const periodo = pickPeriodo(coverage, question, run, questions.length)
  test.info().annotations.push({
    type: 'pergunta',
    description: `run ${run}: "${question.question}" (${question.family}) em ${periodo}`,
  })

  await test.step('pergunta com stream até o finish', async () => {
    await page.goto(`/pt-BR/chat/?ref=${periodo}`)
    const streamed = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        STREAM_PATH.test(new URL(response.url()).pathname),
      { timeout: 30_000 },
    )
    const first = await ask(page, ptBR.chat.composer.label, question.question)
    expect(first.status, 'a primeira pergunta do run sai pelo stream (não pelo cache)').toBe(
      'accepted',
    )
    const stream = await streamed
    expect(stream.status()).toBe(200)
    expect(stream.headers()['content-type']).toContain('text/event-stream')
    // O corpo só fica pronto no fim do stream (teto de 100 s na API).
    const body = await stream.text()
    expect(body).toContain('"type":"finish"')
    expect(body.endsWith(SSE_DONE)).toBe(true)
    const answer = page.locator('article[data-message-role="assistant"]').last()
    await expect(answer).toHaveAttribute('aria-busy', 'false')
    await expect(page.getByTestId('chat-live')).toHaveText(ptBR.chat.thread.liveDone)
    // Uma recusa da busca ou do modelo aqui quer dizer pergunta ruim no pool: repetir não daria
    // cache e gastaria a segunda geração.
    await expect(answer.locator('[data-refusal]'), 'resposta fundamentada, não recusa').toHaveCount(
      0,
    )
    await expect(answer.locator('[data-answer-body]')).not.toBeEmpty()
  })

  await test.step('a mesma pergunta vem do cache, sem gerar de novo', async () => {
    const repeated = await ask(page, ptBR.chat.composer.label, question.question)
    expect(repeated.status).toBe('answered')
    expect(repeated.answer?.meta?.cached).toBe(true)
    const answer = page.locator('article[data-message-role="assistant"]').last()
    await expect(answer.locator('[data-degraded="cached"]')).toHaveCount(1)
  })

  await test.step('fora da cobertura: recusa sem LLM', async () => {
    const outside = outOfCoveragePeriodo(coverage)
    await page.goto(`/pt-BR/chat/?ref=${outside}`)
    const refused = await ask(page, ptBR.chat.composer.label, question.question)
    expect(refused.status).toBe('refused')
    expect(refused.refusal?.reason).toBe('out_of_coverage')
    await expect(
      page.locator('article[data-message-role="assistant"] [data-refusal="out_of_coverage"]'),
    ).toBeVisible()
  })

  await test.step('troca o idioma sem perder a página nem a sessão', async () => {
    await page.goto(`/pt-BR/chat/?ref=${periodo}`)
    await page.getByRole('banner').getByRole('button', { name: ptBR.common.language.label }).click()
    await page.getByRole('menuitem', { name: /English/ }).click()
    await expect(page).toHaveURL(new RegExp(`/en/chat/\\?ref=${periodo}$`))
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('textbox', { name: en.chat.composer.label })).toBeEnabled()
  })
})
