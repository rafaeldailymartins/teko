// @vitest-environment happy-dom
import type { PostHogConfig } from 'posthog-js/dist/module.no-external'
import { afterEach, describe, expect, it, vi } from 'vitest'

const KEY = 'phc_chave_publica_de_teste'
const TRACE_ID = '0af7651916cd43dd8448eb211c80319c'

// O SDK falso: conta os imports do `posthog-js` e grava o `init` e as exceções da instância nomeada.
const sdk = vi.hoisted(() => {
  const instance = { captureException: vi.fn() }
  return { imported: 0, instance, posthog: { init: vi.fn(() => instance), capture: vi.fn() } }
})

vi.mock('posthog-js/dist/module.no-external', () => {
  sdk.imported += 1
  return { default: sdk.posthog }
})

afterEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
  sdk.imported = 0
  sdk.posthog.init.mockClear()
  sdk.instance.captureException.mockClear()
  localStorage.clear()
  sessionStorage.clear()
})

async function appErrorCapture() {
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_ERRORS_KEY', KEY)
  vi.stubEnv('NEXT_PUBLIC_TEKO_RELEASE', 'teko@abc1234')
  const { errorCapture } = await import('./errors.ts')
  return errorCapture
}

/** Espera o `import()` do cliente (o chunk do SDK) e a exceção chegar a ele. */
async function captured(): Promise<void> {
  await vi.waitFor(() => expect(sdk.instance.captureException).toHaveBeenCalled(), {
    timeout: 15_000,
  })
}

describe('cliente de erros (ADR 0037)', () => {
  it('nada do SDK no carregamento; no primeiro erro, uma instância própria só em memória', async () => {
    const capture = await appErrorCapture()
    capture.install(window)
    expect(sdk.imported).toBe(0)

    const error = Object.assign(new Error('internal'), { traceId: TRACE_ID })
    capture.report(error)
    await captured()

    expect(sdk.imported).toBe(1)
    expect(sdk.posthog.init).toHaveBeenCalledTimes(1)
    const [key, config, name] = sdk.posthog.init.mock.calls[0] as unknown as [
      string,
      Partial<PostHogConfig>,
      string,
    ]
    expect(key).toBe(KEY)
    expect(name).toBe('teko_errors')
    expect(config.persistence).toBe('memory')
    expect(config.disable_persistence).toBe(true)
    expect(config.person_profiles).toBe('never')
    expect(sdk.posthog.capture).not.toHaveBeenCalled()
    expect(sdk.instance.captureException).toHaveBeenCalledWith(error, {
      trace_id: TRACE_ID,
      release: 'teko@abc1234',
    })
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(document.cookie).toBe('')
  })

  it('um erro não tratado da janela chega ao cliente', async () => {
    const capture = await appErrorCapture()
    capture.install(window)
    const thrown = new TypeError('quebrou')
    window.dispatchEvent(new ErrorEvent('error', { error: thrown, message: 'quebrou' }))
    await captured()
    expect(sdk.instance.captureException).toHaveBeenCalledWith(thrown, { release: 'teko@abc1234' })
  })
})
