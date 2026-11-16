import { PRIVACY_POLICY_VERSION } from '@teko/shared/legal'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ACCEPT_ALL,
  type ConsentChoices,
  type ConsentRecord,
  REJECT_ALL,
} from '../consent/storage.ts'
import {
  type AnalyticsClient,
  type AnalyticsClientLoader,
  AnalyticsState,
  createAnalytics,
} from './adapter.ts'

const KEY = 'phc_chave_publica_de_teste'

function consent(choices: ConsentChoices): ConsentRecord {
  return { policyVersion: PRIVACY_POLICY_VERSION, decidedAt: '2026-11-15T12:00:00.000Z', choices }
}

function fakeClient() {
  return {
    capture: vi.fn<AnalyticsClient['capture']>(),
    setSurveysEnabled: vi.fn<AnalyticsClient['setSurveysEnabled']>(),
    disable: vi.fn<AnalyticsClient['disable']>(),
  }
}

/** Carregador controlado: cada chamada fica pendente até `resolve`/`reject`. */
function deferredLoader() {
  const calls: { resolve: (client: AnalyticsClient) => void; reject: (error: Error) => void }[] = []
  const load = vi.fn<AnalyticsClientLoader>(
    () =>
      new Promise((resolve, reject) => {
        calls.push({ resolve, reject })
      }),
  )
  return { load, calls }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createAnalytics: nada carrega sem consentimento', () => {
  it.each([
    ['sem escolha', null],
    ['recusa', consent(REJECT_ALL)],
    ['só pesquisas', consent({ analytics: false, surveys: true })],
  ])('%s: não chama o carregador e descarta eventos', async (_case, choice) => {
    const client = fakeClient()
    const load = vi.fn<AnalyticsClientLoader>(async () => client)
    const analytics = createAnalytics({ key: KEY, load })

    expect(await analytics.applyConsent(choice)).toBe(AnalyticsState.Disabled)
    analytics.capture('diff_opened', {})
    expect(load).not.toHaveBeenCalled()
    expect(client.capture).not.toHaveBeenCalled()
  })

  it('sem a chave pública, nem o aceite carrega (staging, CI e desenvolvimento)', async () => {
    const load = vi.fn<AnalyticsClientLoader>(async () => fakeClient())
    const analytics = createAnalytics({ key: undefined, load })
    expect(await analytics.applyConsent(consent(ACCEPT_ALL))).toBe(AnalyticsState.Disabled)
    expect(load).not.toHaveBeenCalled()
  })
})

describe('createAnalytics: com consentimento', () => {
  it('carrega uma vez com a chave e as pesquisas, e repassa os eventos', async () => {
    const client = fakeClient()
    const load = vi.fn<AnalyticsClientLoader>(async () => client)
    const analytics = createAnalytics({ key: KEY, load })

    expect(await analytics.applyConsent(consent({ analytics: true, surveys: false }))).toBe(
      AnalyticsState.Loaded,
    )
    expect(load).toHaveBeenCalledExactlyOnceWith({ key: KEY, surveys: false })
    expect(client.setSurveysEnabled).toHaveBeenLastCalledWith(false)

    analytics.capture('consent_updated', { analytics: true })
    expect(client.capture).toHaveBeenCalledExactlyOnceWith('consent_updated', { analytics: true })

    // Mudar só as pesquisas reaproveita o cliente.
    expect(await analytics.applyConsent(consent(ACCEPT_ALL))).toBe(AnalyticsState.Loaded)
    expect(load).toHaveBeenCalledOnce()
    expect(client.setSurveysEnabled).toHaveBeenLastCalledWith(true)
  })

  it('retirar o consentimento desliga o cliente e volta a descartar eventos', async () => {
    const client = fakeClient()
    const analytics = createAnalytics({ key: KEY, load: async () => client })
    await analytics.applyConsent(consent(ACCEPT_ALL))

    expect(await analytics.applyConsent(consent(REJECT_ALL))).toBe(AnalyticsState.Disabled)
    expect(client.disable).toHaveBeenCalledOnce()
    analytics.capture('diff_opened', {})
    expect(client.capture).not.toHaveBeenCalled()
  })

  it('recusa durante o carregamento: o cliente que chega é desligado, nunca ativado', async () => {
    const { load, calls } = deferredLoader()
    const analytics = createAnalytics({ key: KEY, load })
    const accepting = analytics.applyConsent(consent(ACCEPT_ALL))

    expect(await analytics.applyConsent(consent(REJECT_ALL))).toBe(AnalyticsState.Disabled)
    const client = fakeClient()
    calls[0]?.resolve(client)
    expect(await accepting).toBe(AnalyticsState.Disabled)
    expect(client.disable).toHaveBeenCalledOnce()
    analytics.capture('diff_opened', {})
    expect(client.capture).not.toHaveBeenCalled()
  })

  it('dois aceites seguidos compartilham o mesmo carregamento', async () => {
    const { load, calls } = deferredLoader()
    const analytics = createAnalytics({ key: KEY, load })
    const first = analytics.applyConsent(consent({ analytics: true, surveys: false }))
    const second = analytics.applyConsent(consent(ACCEPT_ALL))
    const client = fakeClient()
    calls[0]?.resolve(client)

    expect(await Promise.all([first, second])).toEqual([
      AnalyticsState.Loaded,
      AnalyticsState.Loaded,
    ])
    expect(load).toHaveBeenCalledOnce()
    expect(client.disable).not.toHaveBeenCalled()
    expect(client.setSurveysEnabled).toHaveBeenLastCalledWith(true)
  })

  it('falha no carregamento deixa desligado e permite tentar de novo', async () => {
    const { load, calls } = deferredLoader()
    const analytics = createAnalytics({ key: KEY, load })
    const failing = analytics.applyConsent(consent(ACCEPT_ALL))
    calls[0]?.reject(new Error('chunk indisponível'))
    expect(await failing).toBe(AnalyticsState.Disabled)

    const retry = analytics.applyConsent(consent(ACCEPT_ALL))
    calls[1]?.resolve(fakeClient())
    expect(await retry).toBe(AnalyticsState.Loaded)
    expect(load).toHaveBeenCalledTimes(2)
  })
})
