import { describe, expect, it } from 'vitest'
import {
  parseThemePreference,
  resolveTheme,
  THEME_ATTRIBUTE,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_STORAGE_KEY,
  ThemePreference,
} from './theme.ts'

describe('parseThemePreference', () => {
  it.each(['light', 'dark'] as const)('aceita %s', (value) => {
    expect(parseThemePreference(value)).toBe(value)
  })

  it.each([null, undefined, '', 'system', 'DARK', 'auto', 1, {}])(
    'cai em system para %j',
    (value) => {
      expect(parseThemePreference(value)).toBe(ThemePreference.System)
    },
  )
})

describe('resolveTheme', () => {
  it('segue o sistema quando a preferência é system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('a preferência explícita vence o sistema', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

/** Executa o script inline contra um `document` e um `localStorage` falsos. */
function runBootstrap(storage: { getItem: (key: string) => string | null }): Map<string, string> {
  const attributes = new Map<string, string>()
  const document = {
    documentElement: { setAttribute: (name: string, value: string) => attributes.set(name, value) },
  }
  new Function('localStorage', 'document', THEME_BOOTSTRAP_SCRIPT)(storage, document)
  return attributes
}

describe('THEME_BOOTSTRAP_SCRIPT', () => {
  it('aplica a preferência salva em data-theme', () => {
    const attributes = runBootstrap({
      getItem: (key) => (key === THEME_STORAGE_KEY ? 'dark' : null),
    })
    expect(attributes.get(THEME_ATTRIBUTE)).toBe('dark')
  })

  it('não toca no DOM sem preferência válida (o CSS segue o sistema)', () => {
    expect(runBootstrap({ getItem: () => null }).size).toBe(0)
    expect(runBootstrap({ getItem: () => '<script>' }).size).toBe(0)
  })

  it('ignora storage indisponível (modo privado, cookies bloqueados)', () => {
    const attributes = runBootstrap({
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
    })
    expect(attributes.size).toBe(0)
  })

  // O script é um literal fixo (sem interpolação, para não montar código a partir de valores);
  // este teste amarra o literal às constantes, para que nenhum dos dois mude sozinho.
  it('usa as mesmas chaves e valores que as constantes do módulo', () => {
    for (const value of [
      THEME_STORAGE_KEY,
      THEME_ATTRIBUTE,
      ThemePreference.Light,
      ThemePreference.Dark,
    ]) {
      expect(THEME_BOOTSTRAP_SCRIPT).toContain(JSON.stringify(value))
    }
    expect(THEME_BOOTSTRAP_SCRIPT).toContain(
      `localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})`,
    )
    expect(THEME_BOOTSTRAP_SCRIPT).toContain(`setAttribute(${JSON.stringify(THEME_ATTRIBUTE)},t)`)
    expect(THEME_BOOTSTRAP_SCRIPT).not.toContain(JSON.stringify(ThemePreference.System))
  })

  it('é estável (o hash sha256 dele vai para o CSP)', () => {
    expect(THEME_BOOTSTRAP_SCRIPT).toMatchInlineSnapshot(
      `"(function(){try{var t=localStorage.getItem("teko-theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})()"`,
    )
  })
})
