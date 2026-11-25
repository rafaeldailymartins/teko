import { describe, expect, it, vi } from 'vitest'
import { lazyModule } from './lazy-module.ts'

describe('lazyModule', () => {
  it('não carrega nada até a primeira chamada e carrega uma vez só', async () => {
    const load = vi.fn(async () => ({ value: 42 }))
    const get = lazyModule(load)
    expect(load).not.toHaveBeenCalled()

    const [first, second] = await Promise.all([get(), get()])
    const third = await get()

    expect(load).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
    expect(third).toBe(first)
  })

  it('não guarda a falha: a chamada seguinte tenta de novo', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('ERR_MODULE_NOT_FOUND'))
      .mockResolvedValueOnce('ok')
    const get = lazyModule(load)

    await expect(get()).rejects.toThrow('ERR_MODULE_NOT_FOUND')
    await expect(get()).resolves.toBe('ok')
    await expect(get()).resolves.toBe('ok')
    expect(load).toHaveBeenCalledTimes(2)
  })
})
