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
