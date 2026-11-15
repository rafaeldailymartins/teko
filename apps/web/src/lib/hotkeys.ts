/**
 * Atalhos de teclado globais. Por ora só a paleta (`Ctrl/⌘+K`); os demais atalhos da UX (`/`,
 * `Ctrl/⌘+Enter`, `[`/`]`, `Alt+D`) entram com o chat, no mesmo módulo.
 */

type KeyChord = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

/** `Ctrl+K` ou `⌘+K`, sem Alt nem Shift (que o navegador e os leitores de tela usam). */
export function isCommandPaletteShortcut(event: KeyChord): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'k'
  )
}

/** macOS e iOS usam `⌘`; os demais sistemas, `Ctrl`. */
export function isApplePlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform)
}

/** Rótulo visível do atalho da paleta para a plataforma. */
export function commandPaletteShortcutLabel(apple: boolean): string {
  return apple ? '⌘K' : 'Ctrl K'
}
