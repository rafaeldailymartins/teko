// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import {
  createErrorCapture,
  type ErrorClient,
  type ErrorProperties,
  MAX_ERRORS_PER_PAGE,
  traceIdOf,
} from './error-capture.ts'

const KEY = 'phc_chave_publica_de_teste'
const TRACE_ID = '0af7651916cd43dd8448eb211c80319c'

function recordingClient() {
  const captured: { error: unknown; properties: ErrorProperties }[] = []
  const client: ErrorClient = {
    capture: (error, properties) => captured.push({ error, properties }),
  }
  return { client, captured }
}

/** Espera o `import()` (a promise do carregador) e o `then` da captura. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('traceIdOf', () => {
  it('lê o trace_id W3C de um erro da API e ignora o resto', () => {
    expect(traceIdOf({ traceId: TRACE_ID })).toBe(TRACE_ID)
    expect(traceIdOf({ traceId: 'req-1' })).toBeNull()
    expect(traceIdOf({ traceId: null })).toBeNull()
    expect(traceIdOf(new Error('x'))).toBeNull()
    expect(traceIdOf('texto')).toBeNull()
    expect(traceIdOf(null)).toBeNull()
  })
})

describe('createErrorCapture', () => {
  it('sem a chave, nada é carregado nem escutado', async () => {
    const load = vi.fn()
    const target = new EventTarget()
    const add = vi.spyOn(target, 'addEventListener')
    const capture = createErrorCapture({ key: undefined, release: 'teko@0.1.0', load })
    capture.install(target)
    capture.report(new Error('x'))
    await settle()
    expect(load).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
  })

  it('o SDK só é carregado no primeiro erro, uma vez, e recebe a fila com release e trace_id', async () => {
    const { client, captured } = recordingClient()
    const load = vi.fn(async () => client)
    const capture = createErrorCapture({ key: KEY, release: 'teko@abc1234', load })
    expect(load).not.toHaveBeenCalled()

    const first = new Error('primeiro')
    const fromApi = Object.assign(new Error('internal'), { traceId: TRACE_ID })
    capture.report(first)
    capture.report(fromApi)
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith(KEY)
    await settle()
    capture.report(new Error('depois de carregado'))

    expect(load).toHaveBeenCalledTimes(1)
    expect(captured.map((item) => item.properties)).toEqual([
      { release: 'teko@abc1234' },
      { release: 'teko@abc1234', trace_id: TRACE_ID },
      { release: 'teko@abc1234' },
    ])
    expect(captured[0]?.error).toBe(first)
  })

  it('sem release no build, o evento sai sem ele', async () => {
    const { client, captured } = recordingClient()
    const capture = createErrorCapture({ key: KEY, release: undefined, load: async () => client })
    capture.report(new Error('x'))
    await settle()
    expect(captured[0]?.properties).toEqual({})
  })

  it('o mesmo erro sai uma vez, e no máximo MAX_ERRORS_PER_PAGE por página', async () => {
    const { client, captured } = recordingClient()
    const capture = createErrorCapture({ key: KEY, release: undefined, load: async () => client })
    const repeated = new Error('em laço')
    capture.report(repeated)
    capture.report(repeated)
    for (let index = 0; index < MAX_ERRORS_PER_PAGE + 5; index += 1) {
      capture.report(new Error(`erro ${index}`))
    }
    capture.report('valor solto')
    await settle()
    expect(captured).toHaveLength(MAX_ERRORS_PER_PAGE)
  })

  it('falha ao carregar o SDK desliga a captura, sem lançar', async () => {
    const load = vi.fn(async (): Promise<ErrorClient> => {
      throw new Error('chunk')
    })
    const capture = createErrorCapture({ key: KEY, release: undefined, load })
    capture.report(new Error('a'))
    await settle()
    capture.report(new Error('b'))
    await settle()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('um SDK que lança não derruba a página', async () => {
    const capture = createErrorCapture({
      key: KEY,
      release: undefined,
      load: async () => ({
        capture: () => {
          throw new Error('sdk')
        },
      }),
    })
    capture.report(new Error('a'))
    await settle()
    expect(() => capture.report(new Error('b'))).not.toThrow()
  })

  it('escuta error e unhandledrejection da janela; erro de recurso fica de fora', async () => {
    const { client, captured } = recordingClient()
    const capture = createErrorCapture({ key: KEY, release: undefined, load: async () => client })
    const target = new EventTarget()
    capture.install(target)
    const thrown = new TypeError('quebrou')
    target.dispatchEvent(new ErrorEvent('error', { error: thrown, message: 'quebrou' }))
    target.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }))
    target.dispatchEvent(new ErrorEvent('error', { message: '' }))
    target.dispatchEvent(new Event('error'))
    const rejection = new Event('unhandledrejection')
    Object.defineProperty(rejection, 'reason', { value: 'motivo' })
    target.dispatchEvent(rejection)
    target.dispatchEvent(new Event('unhandledrejection'))
    await settle()
    expect(captured.map((item) => item.error)).toEqual([
      thrown,
      new Error('Script error.'),
      'motivo',
    ])
  })
})
