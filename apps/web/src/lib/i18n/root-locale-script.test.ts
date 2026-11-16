import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { rootLocaleFor } from './root-locale.ts'

/** O script da página de entrada `/` (servido de `public/`, fora do bundle). */
const script = readFileSync(new URL('../../../public/root-locale.js', import.meta.url), 'utf8')

/** Roda o script com um navegador falso e devolve para onde ele mandou. */
function destination(languages: readonly string[] | undefined, language = ''): string | undefined {
  let target: string | undefined
  runInNewContext(script, {
    navigator: { languages, language },
    location: {
      replace: (url: string) => {
        target = url
      },
    },
  })
  return target
}

describe('public/root-locale.js', () => {
  it.each([
    [['en-US', 'en'], '/en/'],
    [['en'], '/en/'],
    [['pt-BR', 'en-US'], '/pt-BR/'],
    [['es-ES', 'en'], '/pt-BR/'],
    [[], '/pt-BR/'],
  ] as const)('navigator.languages %j vai para %s', (languages, expected) => {
    expect(destination(languages)).toBe(expected)
  })

  it('sem navigator.languages, usa navigator.language', () => {
    expect(destination(undefined, 'en-GB')).toBe('/en/')
    expect(destination(undefined, '')).toBe('/pt-BR/')
  })

  it('segue a mesma regra do Accept-Language para o primeiro idioma', () => {
    for (const first of ['en-US', 'en', 'eng', 'pt-BR', 'fr', 'en-Latn-US']) {
      expect(destination([first])).toBe(`/${rootLocaleFor(first)}/`)
    }
  })
})
