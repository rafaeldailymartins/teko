// @vitest-environment happy-dom
import { PRIVACY_POLICY_VERSION } from '@teko/shared/legal'
import type { BeforeSendFn, CaptureResult, PostHogConfig } from 'posthog-js/dist/module.no-external'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCEPT_ALL,
  type ConsentChoices,
  type ConsentRecord,
  REJECT_ALL,
} from '../consent/storage.ts'

const KEY = 'phc_chave_publica_de_teste'

// O SDK falso: conta quantas vezes cada módulo do `posthog-js` foi importado e grava as chamadas.
const sdk = vi.hoisted(() => ({
  imported: 0,
  surveysImported: 0,
  posthog: {
    init: vi.fn(),
    capture: vi.fn(),
    set_config: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
  },
}))

vi.mock('posthog-js/dist/module.no-external', () => {
  sdk.imported += 1
  return { default: sdk.posthog }
})
vi.mock('posthog-js/dist/surveys', () => {
  sdk.surveysImported += 1
  return {}
})

function consent(choices: ConsentChoices): ConsentRecord {
  return { policyVersion: PRIVACY_POLICY_VERSION, decidedAt: '2026-11-17T12:00:00.000Z', choices }
}

/** Adapter real com o carregador real, cada teste com módulos novos (o cliente guarda estado). */
async function appAnalytics(key: string | undefined) {
  const { createAnalytics } = await import('./adapter.ts')
  const { loadAnalyticsClient } = await import('./client-loader.ts')
  return createAnalytics({ key, load: loadAnalyticsClient })
}

function initConfig(): Partial<PostHogConfig> {
  const config: unknown = sdk.posthog.init.mock.calls[0]?.[1]
  expect(config).toBeDefined()
  return config as Partial<PostHogConfig>
}

function beforeSend(): BeforeSendFn {
  const hook = initConfig().before_send
  if (typeof hook !== 'function') {
    throw new TypeError('before_send ausente')
  }
  return hook
}

function captured(event: string, properties: CaptureResult['properties'] = {}): CaptureResult {
  return { uuid: 'u', event, properties }
}
/** O `document` do happy-dom como pote de cookies (o teste grava cookies para conferir a limpeza). */
function cookieJar(): Pick<Document, 'cookie'> {
  return document
}

function cookieNames(): string[] {
  return document.cookie
    .split(';')
    .map((cookie) => cookie.split('=')[0]?.trim() ?? '')
    .filter((name) => name !== '')
}

beforeEach(() => {
  vi.resetModules()
  sdk.imported = 0
  sdk.surveysImported = 0
  for (const fn of Object.values(sdk.posthog)) fn.mockClear()
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  for (const name of cookieNames()) {
    cookieJar().cookie = `${name}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/`
  }
})

describe('carregador: nada do SDK sem consentimento e chave', () => {
  it.each([
    ['sem escolha', null],
    ['recusa', consent(REJECT_ALL)],
    ['só pesquisas', consent({ analytics: false, surveys: true })],
  ])('%s: não importa o posthog-js nem grava cookie ou storage', async (_case, choice) => {
    const analytics = await appAnalytics(KEY)
    await analytics.applyConsent(choice)
    analytics.capture('diff_opened', {})

    expect(sdk.imported).toBe(0)
    expect(sdk.surveysImported).toBe(0)
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(cookieNames()).toEqual([])
  })

  it('com aceite e sem a chave pública continua no-op', async () => {
    const analytics = await appAnalytics(undefined)
    await analytics.applyConsent(consent(ACCEPT_ALL))
    analytics.capture('diff_opened', {})

    expect(sdk.imported).toBe(0)
    expect(sdk.posthog.init).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })
})

describe('cliente do PostHog', () => {
  it('com aceite: init na UE, sem script externo, cookieless ao recusar e sem replay', async () => {
    const analytics = await appAnalytics(KEY)
    await analytics.applyConsent(consent({ analytics: true, surveys: false }))

    expect(sdk.imported).toBe(1)
    expect(sdk.surveysImported).toBe(1)
    expect(sdk.posthog.init).toHaveBeenCalledExactlyOnceWith(KEY, expect.any(Object))
    expect(initConfig()).toMatchObject({
      api_host: 'https://eu.i.posthog.com',
      disable_external_dependency_loading: true,
      cookieless_mode: 'on_reject',
      person_profiles: 'identified_only',
      persistence: 'localStorage',
      disable_session_recording: true,
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_exceptions: false,
      disable_surveys: true,
    })
    expect(sdk.posthog.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false })
    expect(sdk.posthog.set_config).toHaveBeenLastCalledWith({ disable_surveys: true })
  })

  it('valida pelo catálogo: o texto da pergunta e propriedades desconhecidas não saem', async () => {
    const analytics = await appAnalytics(KEY)
    await analytics.applyConsent(consent(ACCEPT_ALL))

    analytics.capture('question_asked', { locale: 'pt-BR', reference_source: 'default' })
    expect(sdk.posthog.capture).toHaveBeenCalledExactlyOnceWith('question_asked', {
      locale: 'pt-BR',
      reference_source: 'default',
    })

    sdk.posthog.capture.mockClear()
    const withQuestion = {
      locale: 'pt-BR',
      reference_source: 'default',
      question: 'Qual a alíquota do ICMS?',
    } as const
    analytics.capture('question_asked', withQuestion)
    analytics.capture('diff_opened', { stableKey: 'go:rcte:art:76' } as never)
    expect(sdk.posthog.capture).not.toHaveBeenCalled()
  })

  it('pesquisas acompanham a escolha', async () => {
    const analytics = await appAnalytics(KEY)
    await analytics.applyConsent(consent({ analytics: true, surveys: false }))
    await analytics.applyConsent(consent(ACCEPT_ALL))
    expect(sdk.posthog.set_config).toHaveBeenLastCalledWith({ disable_surveys: false })
    expect(sdk.posthog.init).toHaveBeenCalledOnce()
  })

  it('retirar o consentimento faz o opt-out, corta o before_send e limpa o navegador', async () => {
    const analytics = await appAnalytics(KEY)
    await analytics.applyConsent(consent(ACCEPT_ALL))
    expect(beforeSend()(captured('diff_opened'))).not.toBeNull()

    localStorage.setItem(`ph_${KEY}_posthog`, '{}')
    localStorage.setItem(`__ph_opt_in_out_${KEY}`, '1')
    localStorage.setItem('seenSurvey_123', 'true')
    localStorage.setItem('lastSeenSurveyDate', '2026-11-17')
    localStorage.setItem('teko-consent', '{}')
    localStorage.setItem('teko-theme', 'dark')
    sessionStorage.setItem(`ph_${KEY}_window_id`, 'w')
    cookieJar().cookie = `ph_${KEY}_posthog=1; Path=/`
    cookieJar().cookie = 'outro=1; Path=/'

    await analytics.applyConsent(consent(REJECT_ALL))

    expect(sdk.posthog.opt_out_capturing).toHaveBeenCalledOnce()
    expect(sdk.posthog.set_config).toHaveBeenLastCalledWith({ disable_surveys: true })
    expect(Object.keys({ ...localStorage }).sort()).toEqual(['teko-consent', 'teko-theme'])
    expect(sessionStorage.length).toBe(0)
    expect(cookieNames()).toEqual(['outro'])
    expect(beforeSend()(captured('diff_opened'))).toBeNull()

    sdk.posthog.capture.mockClear()
    analytics.capture('diff_opened', {})
    expect(sdk.posthog.capture).not.toHaveBeenCalled()
  })

  it('novo aceite na mesma página reaproveita a instância e refaz o opt-in', async () => {
    const analytics = await appAnalytics(KEY)
    await analytics.applyConsent(consent(ACCEPT_ALL))
    await analytics.applyConsent(consent(REJECT_ALL))
    sdk.posthog.opt_in_capturing.mockClear()

    await analytics.applyConsent(consent(ACCEPT_ALL))
    expect(sdk.posthog.init).toHaveBeenCalledOnce()
    expect(sdk.posthog.opt_in_capturing).toHaveBeenCalledOnce()
    expect(beforeSend()(captured('diff_opened'))).not.toBeNull()
  })
})
