import { PRIVACY_POLICY_VERSION } from '@teko/shared/legal'

/**
 * Escolha de consentimento LGPD do navegador. Fica em `localStorage['teko-consent']`, gravada só
 * depois que a pessoa decide (antes disso, nada é escrito), junto da versão da política de
 * privacidade. Uma versão nova da política invalida a escolha e o banner volta.
 *
 * Os cookies e o storage estritamente necessários (sessão de login, tema e esta própria escolha)
 * não dependem de consentimento e ficam fora das categorias.
 */

export const CONSENT_STORAGE_KEY = 'teko-consent'

/** Evento disparado na `window` quando a escolha muda nesta aba (o `storage` cobre as outras). */
export const CONSENT_CHANGE_EVENT = 'teko-consent-change'

/** Categorias opcionais, na ordem em que aparecem nas preferências. */
export const CONSENT_CATEGORIES = ['analytics', 'surveys'] as const

type ConsentCategory = (typeof CONSENT_CATEGORIES)[number]

export type ConsentChoices = Readonly<Record<ConsentCategory, boolean>>

export interface ConsentRecord {
  /** Versão da política de privacidade vigente quando a pessoa decidiu. */
  readonly policyVersion: string
  /** Momento da decisão (ISO 8601, UTC). */
  readonly decidedAt: string
  readonly choices: ConsentChoices
}

export const ACCEPT_ALL: ConsentChoices = { analytics: true, surveys: true }
export const REJECT_ALL: ConsentChoices = { analytics: false, surveys: false }

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'setItem'>

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Lê o valor gravado (não confiável: outra versão do app, extensão, edição manual). Devolve `null`
 * se faltar, não for JSON, tiver outro formato ou for de outra versão da política.
 */
export function parseConsentRecord(
  raw: string | null | undefined,
  policyVersion: string = PRIVACY_POLICY_VERSION,
): ConsentRecord | null {
  if (raw === null || raw === undefined) {
    return null
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecordObject(value) || !isRecordObject(value['choices'])) {
    return null
  }
  const { choices } = value
  if (
    value['policyVersion'] !== policyVersion ||
    typeof value['decidedAt'] !== 'string' ||
    Number.isNaN(Date.parse(value['decidedAt'])) ||
    !CONSENT_CATEGORIES.every((category) => typeof choices[category] === 'boolean')
  ) {
    return null
  }
  return {
    policyVersion,
    decidedAt: value['decidedAt'],
    choices: { analytics: choices['analytics'] === true, surveys: choices['surveys'] === true },
  }
}

/**
 * Valor cru gravado, para o `useSyncExternalStore` (uma string é estável entre leituras; o objeto
 * sai do `parseConsentRecord`). Storage ausente ou bloqueado vale "sem escolha".
 */
export function readConsentSnapshot(storage: ReadableStorage | null): string | null {
  try {
    return storage?.getItem(CONSENT_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

/**
 * Grava a escolha com a versão da política e o momento. Devolve o registro e se ele foi
 * persistido: com o storage bloqueado, a escolha vale só para a página atual.
 */
export function writeConsent(
  storage: WritableStorage | null,
  choices: ConsentChoices,
  now: Date = new Date(),
): { readonly record: ConsentRecord; readonly persisted: boolean } {
  const record: ConsentRecord = {
    policyVersion: PRIVACY_POLICY_VERSION,
    decidedAt: now.toISOString(),
    choices: { analytics: choices.analytics, surveys: choices.surveys },
  }
  if (storage === null) {
    return { record, persisted: false }
  }
  try {
    storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record))
    return { record, persisted: true }
  } catch {
    return { record, persisted: false }
  }
}

/** Assina as mudanças da escolha (desta aba e das outras); devolve o cancelamento. */
export function subscribeConsent(target: EventTarget, onChange: () => void): () => void {
  const onStorage = (event: Event) => {
    // `key: null` é um `clear()` de outra aba.
    const { key } = event as StorageEvent
    if (key === null || key === CONSENT_STORAGE_KEY) {
      onChange()
    }
  }
  target.addEventListener(CONSENT_CHANGE_EVENT, onChange)
  target.addEventListener('storage', onStorage)
  return () => {
    target.removeEventListener(CONSENT_CHANGE_EVENT, onChange)
    target.removeEventListener('storage', onStorage)
  }
}
