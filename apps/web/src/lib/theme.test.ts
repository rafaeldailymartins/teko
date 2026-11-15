import { describe, expect, it, vi } from 'vitest'
import {
  applyThemePreference,
  parseThemePreference,
  readThemePreference,
  resolveTheme,
  subscribeThemePreference,
  THEME_ATTRIBUTE,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  ThemePreference,
} from './theme.ts'

/** Storage e `<html>` falsos, para observar o que `applyThemePreference` escreve. */
function fakeTarget(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  const attributes = new Map<string, string>()
  return {
    store,
    attributes,
    storage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    root: {
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
      removeAttribute: (name: string) => void attributes.delete(name),
    },
  }
}

describe('readThemePreference', () => {
  it('lê a preferência salva', () => {
    expect(readThemePreference(fakeTarget({ [THEME_STORAGE_KEY]: 'dark' }).storage)).toBe('dark')
  })

  it('cai em system sem storage, com valor inválido ou com storage bloqueado', () => {
    expect(readThemePreference(null)).toBe('system')
    expect(readThemePreference(fakeTarget({ [THEME_STORAGE_KEY]: 'sepia' }).storage)).toBe('system')
    const blocked = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
    }
    expect(readThemePreference(blocked)).toBe('system')
  })
})

describe('applyThemePreference', () => {
  it('grava a preferência explícita no storage e no data-theme', () => {
    const target = fakeTarget()
    applyThemePreference('dark', target)
    expect(target.store.get(THEME_STORAGE_KEY)).toBe('dark')
    expect(target.attributes.get(THEME_ATTRIBUTE)).toBe('dark')
  })

  it('system apaga a chave e o atributo (o CSS volta a seguir o sistema)', () => {
    const target = fakeTarget({ [THEME_STORAGE_KEY]: 'light' })
    target.attributes.set(THEME_ATTRIBUTE, 'light')
    applyThemePreference('system', target)
    expect(target.store.has(THEME_STORAGE_KEY)).toBe(false)
    expect(target.attributes.has(THEME_ATTRIBUTE)).toBe(false)
  })

  it('troca o tema da página mesmo sem storage ou com storage que falha', () => {
    const withoutStorage = fakeTarget()
    applyThemePreference('light', { storage: null, root: withoutStorage.root })
    expect(withoutStorage.attributes.get(THEME_ATTRIBUTE)).toBe('light')

    const failing = fakeTarget()
    const quota = () => {
      throw new DOMException('quota', 'QuotaExceededError')
    }
    applyThemePreference('dark', {
      storage: { getItem: () => null, setItem: quota, removeItem: quota },
      root: failing.root,
    })
    expect(failing.attributes.get(THEME_ATTRIBUTE)).toBe('dark')
  })
})

describe('subscribeThemePreference', () => {
  function storageEvent(key: string | null): Event {
    return Object.assign(new Event('storage'), { key })
  }

  it('avisa nas trocas desta aba e nas de outras abas, até cancelar', () => {
    const target = new EventTarget()
    const onChange = vi.fn()
    const unsubscribe = subscribeThemePreference(target, onChange)

    target.dispatchEvent(new Event(THEME_CHANGE_EVENT))
    target.dispatchEvent(storageEvent(THEME_STORAGE_KEY))
    target.dispatchEvent(storageEvent(null))
    expect(onChange).toHaveBeenCalledTimes(3)

    target.dispatchEvent(storageEvent('outra-chave'))
    expect(onChange).toHaveBeenCalledTimes(3)

    unsubscribe()
    target.dispatchEvent(new Event(THEME_CHANGE_EVENT))
    target.dispatchEvent(storageEvent(THEME_STORAGE_KEY))
    expect(onChange).toHaveBeenCalledTimes(3)
  })
})

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
      `"(function(){try{var d=document.documentElement,t=localStorage.getItem("teko-theme");if(t==="light"||t==="dark"){d.setAttribute("data-theme",t)}if(localStorage.getItem("teko-density")==="compact"){d.setAttribute("data-density","compact")}}catch(e){}})()"`,
    )
  })
})
