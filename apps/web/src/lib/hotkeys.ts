/**
 * Atalhos de teclado da UX: a paleta (`Ctrl/⌘+K`) e os do chat (`/` foca o composer,
 * `Ctrl/⌘+Enter` envia, `Esc` para o stream, `[`/`]` navegam entre citações e `Alt+D` abre a data
 * de referência). Os de tecla simples só valem fora de campos de texto (`isEditableTarget`).
 */

type KeyChord = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

const noModifier = (event: KeyChord): boolean => !(event.metaKey || event.ctrlKey || event.altKey)

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

/** `Ctrl+Enter` ou `⌘+Enter`: envia a pergunta. */
export function isSubmitShortcut(event: KeyChord): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && event.key === 'Enter'
}

/** Rótulo visível do atalho de envio para a plataforma. */
export function submitShortcutLabel(apple: boolean): string {
  return apple ? '⌘ Enter' : 'Ctrl Enter'
}

/** `/` sem modificador: foca o composer. */
export function isComposerShortcut(event: KeyChord): boolean {
  return noModifier(event) && event.key === '/'
}

/**
 * `Alt+D`: abre a data de referência. Vale também o `code` da tecla física, porque no macOS o
 * Option troca o `key` (`∂`).
 */
export function isReferenceShortcut(event: KeyChord & Pick<KeyboardEvent, 'code'>): boolean {
  return (
    event.altKey &&
    !(event.metaKey || event.ctrlKey) &&
    (event.code === 'KeyD' || event.key.toLowerCase() === 'd')
  )
}

/** `[` volta e `]` avança entre as citações; `0` para qualquer outra tecla. */
export function citationStep(event: KeyChord): -1 | 0 | 1 {
  if (!noModifier(event)) return 0
  if (event.key === '[') return -1
  if (event.key === ']') return 1
  return 0
}

interface TargetLike {
  readonly tagName?: unknown
  readonly isContentEditable?: unknown
}

/** O alvo do evento é um campo de texto (onde `/`, `[` e `]` são digitação). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') return false
  const { tagName, isContentEditable } = target as TargetLike
  return (
    isContentEditable === true ||
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT'
  )
}
