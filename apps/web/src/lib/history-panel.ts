/**
 * Preferência do painel de histórico do chat no desktop (aberto ou recolhido), lembrada entre as
 * visitas. Fica no `localStorage` só como conveniência: storage bloqueado, vazio ou com outro valor
 * vale como "aberto", e falha ao gravar não impede a troca na página atual.
 */

export const HISTORY_PANEL_STORAGE_KEY = 'teko-history-panel'

const COLLAPSED = 'collapsed'

interface PanelStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** O storage do navegador, ou `null` sem `window` ou com o acesso barrado. */
function browserStorage(): PanelStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function readHistoryCollapsed(storage: PanelStorage | null = browserStorage()): boolean {
  try {
    return storage?.getItem(HISTORY_PANEL_STORAGE_KEY) === COLLAPSED
  } catch {
    return false
  }
}

export function writeHistoryCollapsed(
  collapsed: boolean,
  storage: PanelStorage | null = browserStorage(),
): void {
  try {
    if (collapsed) {
      storage?.setItem(HISTORY_PANEL_STORAGE_KEY, COLLAPSED)
    } else {
      storage?.removeItem(HISTORY_PANEL_STORAGE_KEY)
    }
  } catch {
    // Storage cheio ou bloqueado: a escolha vale só nesta página.
  }
}
