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
})
