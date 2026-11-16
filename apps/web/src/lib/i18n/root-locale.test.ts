import { describe, expect, it } from 'vitest'
import { DEV_ACCEPT_LANGUAGE_EN, devRootRedirects, rootLocaleFor } from './root-locale.ts'

/** Cabeçalhos reais e de borda, com o locale que as rotas de produção escolhem para cada um. */
const CASES: readonly (readonly [string | undefined, 'en' | 'pt-BR'])[] = [
  ['en-US,en;q=0.9', 'en'],
  ['en', 'en'],
  ['en-GB', 'en'],
  [' en-US ; q=1', 'en'],
  ['en-Latn-US,pt;q=0.5', 'en'],
  ['pt-BR,pt;q=0.9,en;q=0.8', 'pt-BR'],
  ['pt-BR', 'pt-BR'],
  ['es-ES,en;q=0.5', 'pt-BR'],
  ['fr', 'pt-BR'],
  ['eng', 'pt-BR'],
  ['*', 'pt-BR'],
  ['', 'pt-BR'],
  [undefined, 'pt-BR'],
]

/** Como o Next avalia o `value` de um `has` (`prepare-destination.js`): o header inteiro. */
function nextMatches(value: string, header: string | undefined): boolean {
  return header !== undefined && new RegExp(`^${value}$`).test(header)
}

/** Primeiro redirect da lista cujo `has` casa (ou que não tem `has`), como o Next aplica. */
function devDestination(header: string | undefined): string | undefined {
  return devRootRedirects().find(
    (redirect) =>
      redirect.has === undefined ||
      redirect.has.every((condition) => nextMatches(condition.value, header)),
  )?.destination
}

describe('rootLocaleFor', () => {
  it.each(CASES)('Accept-Language %j → %s', (header, locale) => {
    expect(rootLocaleFor(header)).toBe(locale)
  })

  it('sem header vale o português', () => {
    expect(rootLocaleFor(null)).toBe('pt-BR')
  })
})

describe('devRootRedirects', () => {
  it.each(CASES)('em next dev, %j vai para /%s/', (header, locale) => {
    expect(devDestination(header)).toBe(`/${locale}/`)
  })

  it('a expressão de dev dá o mesmo resultado com ou sem a âncora do Next', () => {
    for (const [header, locale] of CASES) {
      if (header === undefined) continue
      expect(new RegExp(DEV_ACCEPT_LANGUAGE_EN).test(header)).toBe(locale === 'en')
    }
  })

  it('só redireciona a raiz, de forma temporária', () => {
    for (const redirect of devRootRedirects()) {
      expect(redirect.source).toBe('/')
      expect(redirect.permanent).toBe(false)
    }
  })
})
