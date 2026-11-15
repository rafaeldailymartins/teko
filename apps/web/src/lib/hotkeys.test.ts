import { describe, expect, it } from 'vitest'
import {
  commandPaletteShortcutLabel,
  isApplePlatform,
  isCommandPaletteShortcut,
} from './hotkeys.ts'

const chord = (
  key: string,
  modifiers: Partial<Record<'meta' | 'ctrl' | 'alt' | 'shift', boolean>>,
) => ({
  key,
  metaKey: modifiers.meta ?? false,
  ctrlKey: modifiers.ctrl ?? false,
  altKey: modifiers.alt ?? false,
  shiftKey: modifiers.shift ?? false,
})

describe('isCommandPaletteShortcut', () => {
  it('aceita Ctrl+K e ⌘+K, inclusive com Caps Lock', () => {
    expect(isCommandPaletteShortcut(chord('k', { ctrl: true }))).toBe(true)
    expect(isCommandPaletteShortcut(chord('k', { meta: true }))).toBe(true)
    expect(isCommandPaletteShortcut(chord('K', { ctrl: true }))).toBe(true)
  })

  it('recusa K sem modificador, com Alt ou Shift e outras teclas', () => {
    expect(isCommandPaletteShortcut(chord('k', {}))).toBe(false)
    expect(isCommandPaletteShortcut(chord('k', { ctrl: true, alt: true }))).toBe(false)
    expect(isCommandPaletteShortcut(chord('k', { meta: true, shift: true }))).toBe(false)
    expect(isCommandPaletteShortcut(chord('j', { ctrl: true }))).toBe(false)
  })
})

describe('isApplePlatform', () => {
  it.each(['MacIntel', 'iPhone', 'iPad', 'macOS'])('%s usa ⌘', (platform) => {
    expect(isApplePlatform(platform)).toBe(true)
  })

  it.each(['Win32', 'Linux x86_64', 'Android', ''])('%j usa Ctrl', (platform) => {
    expect(isApplePlatform(platform)).toBe(false)
  })
})

describe('commandPaletteShortcutLabel', () => {
  it('mostra o modificador da plataforma', () => {
    expect(commandPaletteShortcutLabel(true)).toBe('⌘K')
    expect(commandPaletteShortcutLabel(false)).toBe('Ctrl K')
  })
})
