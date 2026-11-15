import { ERROR_CODES, type ErrorCode } from '@teko/shared/errors'
import { LOCALES } from '@teko/shared/i18n'
import { describe, expect, expectTypeOf, it } from 'vitest'
import en from '../../../messages/en.json'
import ptBR from '../../../messages/pt-BR.json'
import { diffCatalogKeys, flattenCatalog } from '../../../test/catalog-keys.ts'
import { clientMessages, loadMessages, type Messages, SERVER_ONLY_NAMESPACES } from './messages.ts'

/** Argumentos ICU (`{name}`, `{count, plural, ...}`) de uma mensagem, ordenados. */
function icuArguments(message: string): string[] {
  return [...message.matchAll(/\{\s*([A-Za-z_]\w*)/g)].map((match) => match[1] ?? '').sort()
}

/** Tags de rich text (`<link>…</link>`) de uma mensagem, ordenadas (com repetição). */
function richTags(message: string): string[] {
  return [...message.matchAll(/<([A-Za-z]\w*)>/g)].map((match) => match[1] ?? '').sort()
}

const catalogs = { 'pt-BR': flattenCatalog(ptBR), en: flattenCatalog(en) } as const

describe('catálogos de mensagens', () => {
  // Paridade sobre o catálogo inteiro: todo namespace (inclusive os novos, como legal, about e
  // consent) entra sem lista à parte. O diff mostra a chave que falta ou sobra em en.
  it('pt-BR e en têm exatamente as mesmas chaves', () => {
    expect(diffCatalogKeys(ptBR, en)).toEqual({ missing: [], extra: [] })
  })

  it('os dois idiomas têm os mesmos namespaces de topo', () => {
    expect(Object.keys(en)).toEqual(Object.keys(ptBR))
  })

  it('as mesmas chaves usam as mesmas tags de rich text nos dois idiomas', () => {
    for (const [key, value] of catalogs['pt-BR']) {
      expect(richTags(String(catalogs.en.get(key))), key).toEqual(richTags(String(value)))
    }
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

describe('clientMessages', () => {
  it('tira só os namespaces de servidor (legal e about) das mensagens do cliente', () => {
    const client = clientMessages(ptBR)
    expect(SERVER_ONLY_NAMESPACES).toEqual(['legal', 'about'])
    expect(Object.keys(client)).toEqual(
      Object.keys(ptBR).filter((namespace) => namespace !== 'legal' && namespace !== 'about'),
    )
    expect(client.consent).toBe(ptBR.consent)
    expect(client.common).toBe(ptBR.common)
  })
})
