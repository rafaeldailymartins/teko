import { ERROR_CODES, type ErrorCode } from '@teko/shared/errors'
import { LOCALES } from '@teko/shared/i18n'
import { describe, expect, expectTypeOf, it } from 'vitest'
import en from '../../../messages/en.json'
import ptBR from '../../../messages/pt-BR.json'
import { loadMessages, type Messages } from './messages.ts'

type Catalog = Record<string, unknown>

/** Achata um catálogo em `chave.pontuada → texto`. */
function flatten(catalog: Catalog, prefix = ''): Map<string, unknown> {
  const entries = new Map<string, unknown>()
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [nested, leaf] of flatten(value as Catalog, path)) entries.set(nested, leaf)
    } else {
      entries.set(path, value)
    }
  }
  return entries
}

/** Argumentos ICU (`{name}`, `{count, plural, ...}`) de uma mensagem, ordenados. */
function icuArguments(message: string): string[] {
  return [...message.matchAll(/\{\s*([A-Za-z_]\w*)/g)].map((match) => match[1] ?? '').sort()
}

const catalogs = { 'pt-BR': flatten(ptBR), en: flatten(en) } as const

describe('catálogos de mensagens', () => {
  it('pt-BR e en têm exatamente as mesmas chaves', () => {
    expect([...catalogs.en.keys()].sort()).toEqual([...catalogs['pt-BR'].keys()].sort())
  })

  it.each(LOCALES)('%s: toda mensagem é texto não vazio', (locale) => {
    for (const [key, value] of catalogs[locale]) {
      expect(typeof value, key).toBe('string')
      expect((value as string).trim(), key).not.toBe('')
    }
  })

  it('as mesmas chaves usam os mesmos argumentos ICU nos dois idiomas', () => {
    for (const [key, value] of catalogs['pt-BR']) {
      expect(icuArguments(String(catalogs.en.get(key))), key).toEqual(icuArguments(String(value)))
    }
  })

  // Paridade em dois níveis: o tipo (falha o typecheck) e o valor (falha o teste). Um ErrorCode
  // novo em @teko/shared/errors sem mensagem nos catálogos derruba o CI nos dois.
  it('o namespace errors tem exatamente as chaves de ErrorCode (tipo)', () => {
    expectTypeOf<keyof Messages['errors']>().toEqualTypeOf<ErrorCode>()
  })

  it.each(LOCALES)('%s: há uma mensagem errors.<code> para cada ErrorCode', (locale) => {
    const errorKeys = [...catalogs[locale].keys()].filter((key) => key.startsWith('errors.'))
    expect(errorKeys.sort()).toEqual(ERROR_CODES.map((code) => `errors.${code}`).sort())
  })

  it('o nome do produto é Tekó em todos os idiomas', () => {
    for (const locale of LOCALES) expect(catalogs[locale].get('app.name')).toBe('Tekó')
  })
})

describe('loadMessages', () => {
  it.each(LOCALES)('carrega o catálogo de %s', async (locale) => {
    const messages = await loadMessages(locale)
    expect(messages).toEqual(locale === 'en' ? en : ptBR)
  })
})
