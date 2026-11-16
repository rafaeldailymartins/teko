import { describe, expect, it } from 'vitest'
import {
  HISTORY_PANEL_STORAGE_KEY,
  readHistoryCollapsed,
  writeHistoryCollapsed,
} from './history-panel.ts'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}

const blocked = {
  getItem: (): string | null => {
    throw new Error('SecurityError')
  },
  setItem: (): void => {
    throw new Error('QuotaExceededError')
  },
  removeItem: (): void => {
    throw new Error('SecurityError')
  },
}

describe('preferência do painel de histórico', () => {
  it('lembra o recolhido e volta ao aberto apagando a chave', () => {
    const storage = memoryStorage()
    expect(readHistoryCollapsed(storage)).toBe(false)
    writeHistoryCollapsed(true, storage)
    expect(storage.values.get(HISTORY_PANEL_STORAGE_KEY)).toBe('collapsed')
    expect(readHistoryCollapsed(storage)).toBe(true)
    writeHistoryCollapsed(false, storage)
    expect(storage.values.has(HISTORY_PANEL_STORAGE_KEY)).toBe(false)
  })

  it('valor desconhecido, storage ausente ou bloqueado valem como aberto', () => {
    expect(readHistoryCollapsed(memoryStorage({ [HISTORY_PANEL_STORAGE_KEY]: 'x' }))).toBe(false)
    expect(readHistoryCollapsed(null)).toBe(false)
    expect(readHistoryCollapsed(blocked)).toBe(false)
    expect(() => writeHistoryCollapsed(true, blocked)).not.toThrow()
    expect(() => writeHistoryCollapsed(true, null)).not.toThrow()
  })
})
