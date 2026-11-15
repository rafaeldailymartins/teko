/**
 * Tema claro/escuro feito em casa (o next-themes está parado e avisa no React 19).
 *
 * - Sem preferência salva (`system`), o CSS segue `prefers-color-scheme` e nada é escrito no DOM.
 * - Com `light` ou `dark` em `localStorage['teko-theme']`, o script de inicialização grava
 *   `data-theme` no `<html>` antes da primeira pintura, e os tokens usam `color-scheme` dali.
 */

export const THEME_STORAGE_KEY = 'teko-theme'

/** Atributo do `<html>` lido pelo CSS (`[data-theme='dark']`) e pela variante `dark:`. */
export const THEME_ATTRIBUTE = 'data-theme'

export const ThemePreference = {
  Light: 'light',
  Dark: 'dark',
  System: 'system',
} as const

export type ThemePreference = (typeof ThemePreference)[keyof typeof ThemePreference]

export type ResolvedTheme = Exclude<ThemePreference, 'system'>

/** Lê um valor não confiável (storage, query) e cai em `system` quando não reconhece. */
export function parseThemePreference(value: unknown): ThemePreference {
  return value === ThemePreference.Light || value === ThemePreference.Dark
    ? value
    : ThemePreference.System
}

/** Tema efetivo dada a preferência e o `prefers-color-scheme` do sistema. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === ThemePreference.System) {
    return systemPrefersDark ? ThemePreference.Dark : ThemePreference.Light
  }
  return preference
}

/**
 * Script inline (executado no `<head>`, antes da pintura) que aplica a preferência salva.
 * É uma constante: o hash sha256 dele entra no CSP gerado no pós-build. Falhas de storage
 * (modo privado, cookies bloqueados) caem silenciosamente no tema do sistema.
 *
 * É um literal fixo, sem interpolação: código-fonte não se monta a partir de valores. As chaves
 * (`THEME_STORAGE_KEY`, `THEME_ATTRIBUTE`) e os valores de `ThemePreference` aparecem nele
 * literalmente, e o teste do módulo falha se um lado mudar sem o outro.
 */
export const THEME_BOOTSTRAP_SCRIPT =
  '(function(){try{var t=localStorage.getItem("teko-theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})()'

/** Evento disparado na `window` quando a preferência muda nesta aba (o `storage` cobre as outras). */
export const THEME_CHANGE_EVENT = 'teko-theme-change'

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

interface ThemeTarget {
  /** `localStorage`, ou `null` quando o navegador o bloqueia. */
  readonly storage: ThemeStorage | null
  /** O `<html>`, que recebe `data-theme`. */
  readonly root: Pick<Element, 'setAttribute' | 'removeAttribute'>
}

/** Preferência salva; storage ausente ou bloqueado vale `system`, como no script inicial. */
export function readThemePreference(storage: Pick<Storage, 'getItem'> | null): ThemePreference {
  try {
    return parseThemePreference(storage?.getItem(THEME_STORAGE_KEY))
  } catch {
    return ThemePreference.System
  }
}

/**
 * Aplica e grava a preferência. `system` apaga a chave e o atributo, e o CSS volta a seguir o
 * `prefers-color-scheme`. Falha de storage não impede a troca na página atual.
 */
export function applyThemePreference(
  preference: ThemePreference,
  { storage, root }: ThemeTarget,
): void {
  const isSystem = preference === ThemePreference.System
  if (isSystem) {
    root.removeAttribute(THEME_ATTRIBUTE)
  } else {
    root.setAttribute(THEME_ATTRIBUTE, preference)
  }
  try {
    if (isSystem) {
      storage?.removeItem(THEME_STORAGE_KEY)
    } else {
      storage?.setItem(THEME_STORAGE_KEY, preference)
    }
  } catch {
    // Modo privado ou cookies bloqueados: o tema vale só até a página recarregar.
  }
}

/** Assina as mudanças de preferência (desta aba e das outras); devolve o cancelamento. */
export function subscribeThemePreference(target: EventTarget, onChange: () => void): () => void {
  const onStorage = (event: Event) => {
    // O navegador só entrega `StorageEvent` em `storage`; `key: null` é um `clear()` de outra aba.
    const { key } = event as StorageEvent
    if (key === null || key === THEME_STORAGE_KEY) {
      onChange()
    }
  }
  target.addEventListener(THEME_CHANGE_EVENT, onChange)
  target.addEventListener('storage', onStorage)
  return () => {
    target.removeEventListener(THEME_CHANGE_EVENT, onChange)
    target.removeEventListener('storage', onStorage)
  }
}
