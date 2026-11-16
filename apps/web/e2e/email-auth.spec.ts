import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

/**
 * Login por e-mail e senha (ADR 0036) pela API da stack de CI, sem interface (a tela é da onda
 * seguinte): a stack não tem OAuth apps, então os métodos ativos são passkey e e-mail; o cadastro
 * não abre sessão, a entrada abre, o `/me` pede o onboarding e o `DELETE /me` apaga a conta e o
 * cookie.
 *
 * O rate limit do Better Auth conta por IP (5 entradas por minuto, 5 cadastros a cada 10 minutos),
 * e todas as jornadas da stack saem do mesmo IP: este arquivo faz um cadastro e uma entrada por
 * tentativa, só no projeto desktop.
 */
test.describe('e-mail e senha pela API', () => {
  test.skip(({ isMobile }) => isMobile, 'API sem interface')

  test('cadastra, entra, pede o onboarding e apaga a conta', async ({ request, baseURL }) => {
    const origin = new URL(baseURL ?? 'http://localhost:8080').origin
    const headers = { origin, 'content-type': 'application/json' }
    const email = `e2e-${randomUUID()}@teko.localhost`
    const password = 'uma senha longa de teste'

    const providers = await request.get<unknown>('/api/v1/auth/providers')
    expect(providers.ok()).toBe(true)
    expect(await providers.json()).toEqual({ methods: ['passkey', 'email'] })

    const created = await request.post<unknown>('/api/auth/sign-up/email', {
      headers,
      data: { name: 'Conta de E2E por e-mail', email, password },
    })
    expect(created.status()).toBe(200)
    expect(await created.json()).toMatchObject({ token: null, user: { email } })
    // O cadastro não abre sessão.
    expect((await request.get<unknown>('/api/v1/me')).status()).toBe(401)

    const signedIn = await request.post<unknown>('/api/auth/sign-in/email', {
      headers,
      data: { email, password },
    })
    expect(signedIn.status()).toBe(200)

    // O contexto guarda o cookie de sessão da resposta.
    const me = await request.get<unknown>('/api/v1/me')
    expect(me.ok()).toBe(true)
    expect(await me.json()).toMatchObject({ email, onboarding: { required: true } })

    const removed = await request.delete<unknown>('/api/v1/me', { headers: { origin } })
    expect(removed.status()).toBe(204)
    expect((await request.get<unknown>('/api/v1/me')).status()).toBe(401)
  })
})
