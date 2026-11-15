import type { BrowserContext } from '@playwright/test'

/*
 * Sessão de teste da stack de CI (`E2E_SESSION_COOKIE`, gravada pelo `infra/ci/up.sh`): o cookie
 * para as chamadas diretas à API e injetado no contexto do navegador para as jornadas de interface.
 */

/** `nome=valor` do cookie de sessão da stack de CI. */
export function sessionCookie(): string {
  const cookie = process.env['E2E_SESSION_COOKIE']
  if (cookie === undefined || cookie === '') {
    throw new Error('E2E_SESSION_COOKIE ausente: suba a stack com `bash infra/ci/up.sh`')
  }
  return cookie
}

/**
 * Entra com a sessão de teste (usuário `E2E`, onboarding concluído) pondo o cookie no contexto do
 * navegador, para a origem da stack. Nenhuma jornada sai nem exclui a conta: a sessão é
 * compartilhada pelos workers.
 */
export async function signInWithTestSession(
  context: BrowserContext,
  baseURL: string | undefined,
): Promise<void> {
  const cookie = sessionCookie()
  const separator = cookie.indexOf('=')
  await context.addCookies([
    {
      name: cookie.slice(0, separator),
      value: cookie.slice(separator + 1),
      url: new URL(baseURL ?? 'http://localhost:8080').origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
}
