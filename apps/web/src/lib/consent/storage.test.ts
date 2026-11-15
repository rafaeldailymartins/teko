import { PRIVACY_POLICY_VERSION } from '@teko/shared/legal'
import { describe, expect, it, vi } from 'vitest'
import {
  ACCEPT_ALL,
  CONSENT_CATEGORIES,
  CONSENT_CHANGE_EVENT,
  CONSENT_STORAGE_KEY,
  type ConsentRecord,
  parseConsentRecord,
  REJECT_ALL,
  readConsentSnapshot,
  subscribeConsent,
  writeConsent,
} from './storage.ts'

/** `Storage` em memória, com a mesma interface usada pelo módulo. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  }
}

const throwingStorage = {
  getItem: (): string | null => {
    throw new DOMException('bloqueado', 'SecurityError')
  },
  setItem: (): void => {
    throw new DOMException('cheio', 'QuotaExceededError')
  },
}

const NOW = new Date('2026-11-15T12:34:56.000Z')

function serialized(record: Partial<ConsentRecord> & Record<string, unknown>): string {
  return JSON.stringify({
    policyVersion: PRIVACY_POLICY_VERSION,
    decidedAt: NOW.toISOString(),
    choices: { analytics: true, surveys: false },
    ...record,
  })
}

describe('categorias', () => {
  it('são analytics e pesquisas, com os atalhos de aceitar e recusar tudo', () => {
    expect(CONSENT_CATEGORIES).toEqual(['analytics', 'surveys'])
    expect(ACCEPT_ALL).toEqual({ analytics: true, surveys: true })
    expect(REJECT_ALL).toEqual({ analytics: false, surveys: false })
  })
})

describe('writeConsent', () => {
  it('grava a escolha com a versão da política e o momento', () => {
    const storage = memoryStorage()
    const { record, persisted } = writeConsent(storage, { analytics: true, surveys: false }, NOW)
    expect(persisted).toBe(true)
    expect(record).toEqual({
      policyVersion: PRIVACY_POLICY_VERSION,
      decidedAt: '2026-11-15T12:34:56.000Z',
      choices: { analytics: true, surveys: false },
    })
    expect(JSON.parse(storage.data.get(CONSENT_STORAGE_KEY) ?? '')).toEqual(record)
    expect([...storage.data.keys()]).toEqual([CONSENT_STORAGE_KEY])
  })

  it('não grava propriedades extras vindas do chamador', () => {
    const storage = memoryStorage()
    const choices = { analytics: false, surveys: true, marketing: true }
    writeConsent(storage, choices, NOW)
    expect(JSON.parse(storage.data.get(CONSENT_STORAGE_KEY) ?? '').choices).toEqual({
      analytics: false,
      surveys: true,
    })
  })

  it('com o storage bloqueado ou ausente, devolve a escolha sem persistir', () => {
    expect(writeConsent(throwingStorage, ACCEPT_ALL, NOW).persisted).toBe(false)
    const { record, persisted } = writeConsent(null, REJECT_ALL, NOW)
    expect(persisted).toBe(false)
    expect(record.choices).toEqual(REJECT_ALL)
  })

  it('usa o relógio atual por padrão', () => {
    vi.useFakeTimers({ now: NOW })
    try {
      expect(writeConsent(null, ACCEPT_ALL).record.decidedAt).toBe(NOW.toISOString())
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('readConsentSnapshot', () => {
  it('lê o valor cru, ou null sem escolha, sem storage ou com storage bloqueado', () => {
    expect(readConsentSnapshot(memoryStorage({ [CONSENT_STORAGE_KEY]: 'x' }))).toBe('x')
    expect(readConsentSnapshot(memoryStorage())).toBeNull()
    expect(readConsentSnapshot(null)).toBeNull()
    expect(readConsentSnapshot(throwingStorage)).toBeNull()
  })
})

describe('parseConsentRecord', () => {
  it('aceita o que writeConsent grava (ida e volta)', () => {
    const storage = memoryStorage()
    const { record } = writeConsent(storage, ACCEPT_ALL, NOW)
    expect(parseConsentRecord(readConsentSnapshot(storage))).toEqual(record)
  })

  it.each([
    ['ausente', null],
    ['indefinido', undefined],
    ['JSON inválido', '{'],
    ['não objeto', '"aceito"'],
    ['lista', '[]'],
    ['sem choices', JSON.stringify({ policyVersion: PRIVACY_POLICY_VERSION, decidedAt: 'x' })],
    ['choices em lista', serialized({ choices: [] as unknown as ConsentRecord['choices'] })],
    ['outra versão da política', serialized({ policyVersion: '2000-01-01' })],
    ['data inválida', serialized({ decidedAt: 'ontem' })],
    ['data não textual', serialized({ decidedAt: 1 as unknown as string })],
    [
      'categoria faltando',
      serialized({ choices: { analytics: true } as unknown as ConsentRecord['choices'] }),
    ],
    [
      'categoria não booleana',
      serialized({
        choices: { analytics: 'sim', surveys: false } as unknown as ConsentRecord['choices'],
      }),
    ],
  ])('rejeita valor %s', (_case, raw) => {
    expect(parseConsentRecord(raw)).toBeNull()
  })

  it('normaliza as escolhas e descarta campos extras', () => {
    const raw = serialized({
      choices: { analytics: false, surveys: true, marketing: true } as ConsentRecord['choices'],
      extra: 1,
    })
    expect(parseConsentRecord(raw)).toEqual({
      policyVersion: PRIVACY_POLICY_VERSION,
      decidedAt: NOW.toISOString(),
      choices: { analytics: false, surveys: true },
    })
  })

  it('compara com a versão pedida', () => {
    expect(parseConsentRecord(serialized({ policyVersion: 'v2' }), 'v2')?.policyVersion).toBe('v2')
  })
})

describe('subscribeConsent', () => {
  it('avisa na mudança desta aba e na do storage da chave (ou clear), até cancelar', () => {
    const target = new EventTarget()
    const onChange = vi.fn()
    const unsubscribe = subscribeConsent(target, onChange)

    target.dispatchEvent(new Event(CONSENT_CHANGE_EVENT))
    target.dispatchEvent(Object.assign(new Event('storage'), { key: CONSENT_STORAGE_KEY }))
    target.dispatchEvent(Object.assign(new Event('storage'), { key: null }))
    target.dispatchEvent(Object.assign(new Event('storage'), { key: 'teko-theme' }))
    expect(onChange).toHaveBeenCalledTimes(3)

    unsubscribe()
    target.dispatchEvent(new Event(CONSENT_CHANGE_EVENT))
    target.dispatchEvent(Object.assign(new Event('storage'), { key: CONSENT_STORAGE_KEY }))
    expect(onChange).toHaveBeenCalledTimes(3)
  })
})
