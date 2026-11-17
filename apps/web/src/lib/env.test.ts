import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function loadPublicEnv() {
  const module = await import('./env.ts')
  return module.publicEnv
}

describe('publicEnv', () => {
  it('lê a chave pública do PostHog sem espaços', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '  phc_chave  ')
    expect((await loadPublicEnv()).posthogKey).toBe('phc_chave')
  })

  it.each([
    ['ausente', undefined],
    ['vazia', ''],
    ['só espaços', '   '],
  ])('chave %s vira undefined (analytics desligado)', async (_case, value) => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', value)
    expect((await loadPublicEnv()).posthogKey).toBeUndefined()
  })

  it('lê a chave dos erros e o release do build (ADR 0037)', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_ERRORS_KEY', ' phc_erros ')
    vi.stubEnv('NEXT_PUBLIC_TEKO_RELEASE', 'teko@abc1234')
    const env = await loadPublicEnv()
    expect(env.errorsKey).toBe('phc_erros')
    expect(env.release).toBe('teko@abc1234')
  })

  it('sem chave dos erros nem release, os dois ficam undefined', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_ERRORS_KEY', '')
    vi.stubEnv('NEXT_PUBLIC_TEKO_RELEASE', undefined)
    const env = await loadPublicEnv()
    expect(env.errorsKey).toBeUndefined()
    expect(env.release).toBeUndefined()
  })
})
