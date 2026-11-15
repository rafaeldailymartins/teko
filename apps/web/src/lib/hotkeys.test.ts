import { describe, expect, it } from 'vitest'
import {
  citationStep,
  commandPaletteShortcutLabel,
  isApplePlatform,
  isCommandPaletteShortcut,
  isComposerShortcut,
  isEditableTarget,
  isReferenceShortcut,
  isSubmitShortcut,
  submitShortcutLabel,
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

describe('atalhos do chat', () => {
  it('Ctrl/⌘+Enter envia; Enter sozinho não', () => {
    expect(isSubmitShortcut(chord('Enter', { ctrl: true }))).toBe(true)
    expect(isSubmitShortcut(chord('Enter', { meta: true }))).toBe(true)
    expect(isSubmitShortcut(chord('Enter', {}))).toBe(false)
    expect(isSubmitShortcut(chord('Enter', { ctrl: true, alt: true }))).toBe(false)
    expect(submitShortcutLabel(true)).toBe('⌘ Enter')
    expect(submitShortcutLabel(false)).toBe('Ctrl Enter')
  })

  it('/ foca o composer só sem modificador', () => {
    expect(isComposerShortcut(chord('/', {}))).toBe(true)
    expect(isComposerShortcut(chord('/', { ctrl: true }))).toBe(false)
  })

  it('Alt+D abre a data, inclusive pelo code no macOS', () => {
    expect(isReferenceShortcut({ ...chord('d', { alt: true }), code: 'KeyD' })).toBe(true)
    expect(isReferenceShortcut({ ...chord('∂', { alt: true }), code: 'KeyD' })).toBe(true)
    expect(isReferenceShortcut({ ...chord('D', { alt: true }), code: '' })).toBe(true)
    expect(isReferenceShortcut({ ...chord('d', {}), code: 'KeyD' })).toBe(false)
    expect(isReferenceShortcut({ ...chord('d', { alt: true, ctrl: true }), code: 'KeyD' })).toBe(
      false,
    )
  })

  it('[ e ] navegam entre citações', () => {
    expect(citationStep(chord('[', {}))).toBe(-1)
    expect(citationStep(chord(']', {}))).toBe(1)
    expect(citationStep(chord(']', { ctrl: true }))).toBe(0)
    expect(citationStep(chord('x', {}))).toBe(0)
  })

  it('reconhece campos de texto como alvo editável', () => {
    const target = (value: object) => value as unknown as EventTarget
    expect(isEditableTarget(null)).toBe(false)
    expect(isEditableTarget(target({ tagName: 'TEXTAREA' }))).toBe(true)
    expect(isEditableTarget(target({ tagName: 'INPUT' }))).toBe(true)
    expect(isEditableTarget(target({ tagName: 'SELECT' }))).toBe(true)
    expect(isEditableTarget(target({ tagName: 'DIV', isContentEditable: true }))).toBe(true)
    expect(isEditableTarget(target({ tagName: 'BUTTON' }))).toBe(false)
  })
})
