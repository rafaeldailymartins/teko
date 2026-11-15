import { afterEach, describe, expect, it, vi } from 'vitest'
import { navigateTo } from './browser.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('navigateTo', () => {
  it('faz a navegação completa do documento', () => {
    const assign = vi.fn()
    vi.stubGlobal('window', { location: { assign } })
    navigateTo('/pt-BR/')
    expect(assign).toHaveBeenCalledWith('/pt-BR/')
  })
})
