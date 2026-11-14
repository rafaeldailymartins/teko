import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

/**
 * Jornadas da F4 na stack de CI: a mesma origem serve o estático e a API, a sessão vem por cookie e
 * a pergunta sai em UI Message Stream. As jornadas de interface (chat, chips de citação, data de
 * referência, i18n) chegam com o front da F5.
 */
const GOYAZES =
  'Qual valor mínimo aplicado no GOYAZES ou no PROESPORTE permitia ao Secretário da Fazenda definir prazos diversos de pagamento do ICMS?'

function sessionCookie(): string {
  const cookie = process.env['E2E_SESSION_COOKIE']
  if (cookie === undefined || cookie === '') {
    throw new Error('E2E_SESSION_COOKIE ausente: suba a stack com `bash infra/ci/up.sh`')
  }
  return cookie
}

test.describe('mesma origem', () => {
  test('o estático e o /healthz respondem pela mesma origem', async ({ page, request }) => {
    const response = await page.goto('/')
    expect(response?.ok()).toBe(true)
    expect(new URL(page.url()).pathname).toBe('/pt-BR/')
    await expect(page).toHaveTitle(/Tekó/)
    const health = await request.get<unknown>('/healthz')
    expect(health.ok()).toBe(true)
    expect(await health.json()).toMatchObject({ status: 'ok', env: 'ci' })
  })

  test('a versão em inglês carrega', async ({ page }) => {
    const response = await page.goto('/en/')
    expect(response?.ok()).toBe(true)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })
})

test.describe('API', () => {
  // As jornadas de API não dependem do viewport: só no projeto desktop.
  test.skip(({ isMobile }) => isMobile, 'API sem interface')

  test('cobertura pública, sem sessão', async ({ request }) => {
    const coverage = await request.get<unknown>('/api/v1/coverage')
    expect(coverage.ok()).toBe(true)
    expect(coverage.headers()['cache-control']).toBe('private, no-store')
    const body = (await coverage.json()) as { families: { family: string }[] }
    expect(body.families.map((item) => item.family)).toContain('rcte')
  })

  test('sessão por cookie e mutação de outra origem recusada', async ({ request, baseURL }) => {
    const me = await request.get<unknown>('/api/v1/me', { headers: { cookie: sessionCookie() } })
    expect(me.ok()).toBe(true)
    expect(await me.json()).toMatchObject({ onboarding: { required: false } })
    const foreign = await request.post<unknown>('/api/v1/questions', {
      headers: {
        cookie: sessionCookie(),
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      data: {},
    })
    expect(foreign.status()).toBe(403)
    expect(baseURL).toBeDefined()
  })

  test('pergunta, stream e releitura da resposta', async ({ request, baseURL }) => {
    const headers = {
      origin: new URL(baseURL ?? '').origin,
      'content-type': 'application/json',
      cookie: sessionCookie(),
    }
    const asked = await request.post<unknown>('/api/v1/questions', {
      headers,
      data: {
        conversationId: randomUUID(),
        question: `${GOYAZES} (${randomUUID()})`,
        locale: 'pt-BR',
        families: ['rcte'],
        periodoApuracao: '2006-05',
        source: 'periodo_apuracao',
      },
    })
    expect(asked.ok()).toBe(true)
    const accepted = (await asked.json()) as { status: string; questionId: string }
    expect(accepted.status).toBe('accepted')

    const stream = await request.post<unknown>(`/api/v1/questions/${accepted.questionId}/stream`, {
      headers,
      data: {},
    })
    expect(stream.ok()).toBe(true)
    expect(stream.headers()['x-vercel-ai-ui-message-stream']).toBe('v1')
    const body = await stream.text()
    expect(body).toContain('"type":"data-citation"')
    expect(body).toContain('"type":"finish"')
    expect(body.endsWith('data: [DONE]\n\n')).toBe(true)

    const detail = await request.get<unknown>(`/api/v1/questions/${accepted.questionId}`, {
      headers: { cookie: sessionCookie() },
    })
    expect(await detail.json()).toMatchObject({ status: 'answered' })
  })
})
