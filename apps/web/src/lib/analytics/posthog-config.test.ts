import { ANALYTICS_EVENT_NAMES } from '@teko/shared/analytics'
import type { CaptureResult } from 'posthog-js/dist/module.no-external'
import { describe, expect, it } from 'vitest'
import {
  type BrowserStorageTarget,
  clearPosthogStorage,
  createBeforeSend,
  isAllowedEvent,
  posthogConfig,
  SDK_EVENTS,
  stripUrl,
} from './posthog-config.ts'
import { POSTHOG_API_HOST, POSTHOG_ORIGINS } from './posthog-hosts.ts'

function captured(event: string, extra: Partial<CaptureResult> = {}): CaptureResult {
  return { uuid: 'u', event, properties: {}, ...extra }
}

/** `Storage` em memória (o `clearPosthogStorage` só usa `length`, `key` e `removeItem`). */
function memoryStorage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries))
  return {
    get length() {
      return map.size
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
    clear: () => {
      map.clear()
    },
  }
}

function keys(storage: Storage): string[] {
  return Array.from({ length: storage.length }, (_, index) => storage.key(index) ?? '')
}

describe('hosts', () => {
  it('só a UE: ingestão e assets', () => {
    expect(POSTHOG_ORIGINS).toEqual(['https://eu.i.posthog.com', 'https://eu-assets.i.posthog.com'])
    expect(posthogConfig({ surveys: true, beforeSend: (event) => event }).api_host).toBe(
      POSTHOG_API_HOST,
    )
  })
})

describe('isAllowedEvent', () => {
  it('libera o catálogo e as pesquisas, e nada mais do SDK', () => {
    for (const name of [...ANALYTICS_EVENT_NAMES, ...SDK_EVENTS]) {
      expect(isAllowedEvent(name)).toBe(true)
    }
    for (const name of ['$pageview', '$autocapture', '$opt_in', '$feature_flag_called', '$set']) {
      expect(isAllowedEvent(name)).toBe(false)
    }
  })
})

describe('stripUrl', () => {
  it.each([
    ['https://tekoia.vercel.app/pt-BR/chat/?c=1&q=2#S1', 'https://tekoia.vercel.app/pt-BR/chat/'],
    ['http://localhost:8080/en/?x=1', 'http://localhost:8080/en/'],
    ['HTTPS://Exemplo.com/a?b', 'https://exemplo.com/a'],
    ['/pt-BR/chat/?c=1', '/pt-BR/chat/?c=1'],
    ['pt-BR', 'pt-BR'],
    ['https://[invalido', 'https://[invalido'],
  ])('%s → %s', (value, expected) => {
    expect(stripUrl(value)).toBe(expected)
  })
})

describe('createBeforeSend', () => {
  it('descarta tudo com o analytics desligado', () => {
    expect(createBeforeSend(() => false)(captured('diff_opened'))).toBeNull()
  })

  it('descarta evento fora da lista e o nulo', () => {
    const hook = createBeforeSend(() => true)
    expect(hook(captured('$pageview'))).toBeNull()
    expect(hook(null as unknown as CaptureResult)).toBeNull()
  })

  it('tira query e âncora de toda URL, inclusive em $set e $set_once', () => {
    const hook = createBeforeSend(() => true)
    const result = hook(
      captured('answer_completed', {
        properties: {
          $current_url: 'https://tekoia.vercel.app/pt-BR/chat/?c=abc&q=def',
          $referrer: 'https://busca.exemplo/?q=icms+goias',
          $pathname: '/pt-BR/chat/',
          cached: false,
        },
        $set: { $current_url: 'https://tekoia.vercel.app/en/?q=1' },
        $set_once: { $initial_current_url: 'https://tekoia.vercel.app/en/#x' },
      }),
    )
    expect(result?.properties).toEqual({
      $current_url: 'https://tekoia.vercel.app/pt-BR/chat/',
      $referrer: 'https://busca.exemplo/',
      $pathname: '/pt-BR/chat/',
      cached: false,
    })
    expect(result?.$set).toEqual({ $current_url: 'https://tekoia.vercel.app/en/' })
    expect(result?.$set_once).toEqual({ $initial_current_url: 'https://tekoia.vercel.app/en/' })
  })

  it('evento sem $set continua sem $set', () => {
    const result = createBeforeSend(() => true)(captured('survey sent'))
    expect(result).not.toBeNull()
    expect(result).not.toHaveProperty('$set')
    expect(result).not.toHaveProperty('$set_once')
  })
})

describe('posthogConfig', () => {
  it('pesquisas seguem a escolha', () => {
    const beforeSend = (event: CaptureResult | null) => event
    expect(posthogConfig({ surveys: true, beforeSend }).disable_surveys).toBe(false)
    expect(posthogConfig({ surveys: false, beforeSend }).disable_surveys).toBe(true)
    expect(posthogConfig({ surveys: false, beforeSend }).before_send).toBe(beforeSend)
  })
})

describe('clearPosthogStorage', () => {
  it('apaga só o que é do PostHog, no storage e nos cookies', () => {
    const cookies: string[] = []
    const target: BrowserStorageTarget = {
      localStorage: memoryStorage({
        ph_phc_x_posthog: '{}',
        __ph_opt_in_out_phc_x: '1',
        'posthog-extra': '1',
        seenSurvey_1: 'true',
        inProgressSurvey_1: '{}',
        abandonedSurvey_1: 'true',
        lastSeenSurveyDate: 'x',
        'teko-consent': '{}',
        'teko-theme': 'dark',
      }),
      sessionStorage: memoryStorage({ ph_phc_x_window_id: 'w', outro: '1' }),
      document: {
        get cookie() {
          return 'ph_phc_x_posthog=1; outro=2'
        },
        set cookie(value: string) {
          cookies.push(value)
        },
      },
    }
    clearPosthogStorage(target)
    expect(keys(target.localStorage).sort()).toEqual(['teko-consent', 'teko-theme'])
    expect(keys(target.sessionStorage)).toEqual(['outro'])
    expect(cookies).toEqual([
      'ph_phc_x_posthog=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; SameSite=Lax',
    ])
  })

  it('storage bloqueado não derruba a limpeza', () => {
    const blocked = new Proxy({} as Storage, {
      get() {
        throw new DOMException('bloqueado', 'SecurityError')
      },
    })
    const target: BrowserStorageTarget = {
      localStorage: blocked,
      sessionStorage: blocked,
      document: { cookie: '' },
    }
    expect(() => clearPosthogStorage(target)).not.toThrow()
  })
})
