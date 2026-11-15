import { describe, expect, it, vi } from 'vitest'
import {
  applyDensity,
  DENSITY_ATTRIBUTE,
  DENSITY_CHANGE_EVENT,
  DENSITY_OPTIONS,
  DENSITY_STORAGE_KEY,
  Density,
  parseDensity,
  readDensity,
  subscribeDensity,
} from './density.ts'
import { THEME_BOOTSTRAP_SCRIPT } from './theme.ts'

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

describe('parseDensity e readDensity', () => {
  it('só reconhece compact; o resto é comfortable', () => {
    expect(parseDensity('compact')).toBe(Density.Compact)
    expect(parseDensity('comfortable')).toBe(Density.Comfortable)
    expect(parseDensity('<script>')).toBe(Density.Comfortable)
    expect(DENSITY_OPTIONS).toEqual(['comfortable', 'compact'])
  })

  it('lê do storage e cai no padrão sem storage ou com erro', () => {
    expect(readDensity(fakeTarget({ [DENSITY_STORAGE_KEY]: 'compact' }).storage)).toBe('compact')
    expect(readDensity(null)).toBe('comfortable')
    expect(
      readDensity({
        getItem: () => {
          throw new Error('bloqueado')
        },
      }),
    ).toBe('comfortable')
  })
})

describe('applyDensity', () => {
  it('compact grava o atributo e o storage; comfortable apaga os dois', () => {
    const target = fakeTarget()
    applyDensity(Density.Compact, target)
    expect(target.attributes.get(DENSITY_ATTRIBUTE)).toBe('compact')
    expect(target.store.get(DENSITY_STORAGE_KEY)).toBe('compact')
    applyDensity(Density.Comfortable, target)
    expect(target.attributes.has(DENSITY_ATTRIBUTE)).toBe(false)
    expect(target.store.has(DENSITY_STORAGE_KEY)).toBe(false)
  })

  it('storage bloqueado não impede a troca na página', () => {
    const target = fakeTarget()
    const failing = {
      setItem: () => {
        throw new Error('cota')
      },
      removeItem: () => {
        throw new Error('cota')
      },
    }
    applyDensity(Density.Compact, { storage: failing, root: target.root })
    expect(target.attributes.get(DENSITY_ATTRIBUTE)).toBe('compact')
    applyDensity(Density.Comfortable, { storage: null, root: target.root })
    expect(target.attributes.size).toBe(0)
  })
})

describe('subscribeDensity', () => {
  it('avisa no evento da aba e no storage da chave (ou clear), e cancela', () => {
    const target = new EventTarget()
    const onChange = vi.fn()
    const unsubscribe = subscribeDensity(target, onChange)
    target.dispatchEvent(new Event(DENSITY_CHANGE_EVENT))
    target.dispatchEvent(Object.assign(new Event('storage'), { key: DENSITY_STORAGE_KEY }))
    target.dispatchEvent(Object.assign(new Event('storage'), { key: null }))
    target.dispatchEvent(Object.assign(new Event('storage'), { key: 'teko-theme' }))
    expect(onChange).toHaveBeenCalledTimes(3)
    unsubscribe()
    target.dispatchEvent(new Event(DENSITY_CHANGE_EVENT))
    expect(onChange).toHaveBeenCalledTimes(3)
  })
})

describe('bootstrap da densidade (no script do tema)', () => {
  function runBootstrap(getItem: (key: string) => string | null): Map<string, string> {
    const target = fakeTarget()
    new Function('localStorage', 'document', THEME_BOOTSTRAP_SCRIPT)(
      { getItem },
      { documentElement: target.root },
    )
    return target.attributes
  }

  it('aplica data-density=compact antes da pintura', () => {
    const attributes = runBootstrap((key) => (key === DENSITY_STORAGE_KEY ? 'compact' : null))
    expect(attributes.get(DENSITY_ATTRIBUTE)).toBe('compact')
  })

  it('ignora outros valores e convive com o tema', () => {
    expect(runBootstrap(() => 'comfortable').has(DENSITY_ATTRIBUTE)).toBe(false)
    const both = runBootstrap((key) => (key === DENSITY_STORAGE_KEY ? 'compact' : 'dark'))
    expect([...both.keys()].sort()).toEqual(['data-density', 'data-theme'])
  })

  it('usa literalmente a chave e o atributo do módulo', () => {
    expect(THEME_BOOTSTRAP_SCRIPT).toContain(
      `localStorage.getItem(${JSON.stringify(DENSITY_STORAGE_KEY)})===${JSON.stringify(Density.Compact)}`,
    )
    expect(THEME_BOOTSTRAP_SCRIPT).toContain(
      `setAttribute(${JSON.stringify(DENSITY_ATTRIBUTE)},${JSON.stringify(Density.Compact)})`,
    )
  })
})
