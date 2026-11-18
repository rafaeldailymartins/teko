/**
 * Idioma da raiz `/`: inglês quando o primeiro idioma do `Accept-Language` é inglês (`en`,
 * `en-US`...), português no resto e na falta do header. É a mesma regra das rotas de produção (a
 * Vercel pelo `config.json` e o Caddy da stack de CI), cuja fonte é `ACCEPT_LANGUAGE_EN` em
 * `scripts/lib/static-site-policy.ts`; o teste `scripts/root-locale.test.ts` confere que as duas
 * expressões são iguais.
 *
 * Sem import nenhum: o `next.config.ts` e os scripts da raiz (Node com type stripping) importam
 * este arquivo direto.
 */

/** Primeiro idioma do `Accept-Language` é inglês. Cópia da expressão de `static-site-policy.ts`. */
export const ACCEPT_LANGUAGE_EN = '^\\s*en(?:-[A-Za-z0-9]+)*\\s*(?:[;,]|$)'

/** Locale padrão do Tekó (o primeiro de `LOCALES` em `@teko/shared/i18n`). */
const DEFAULT_ROOT_LOCALE = 'pt-BR'

/** Locale da raiz para um `Accept-Language` (ou a falta dele). */
export function rootLocaleFor(acceptLanguage: string | null | undefined): 'en' | 'pt-BR' {
  return typeof acceptLanguage === 'string' && new RegExp(ACCEPT_LANGUAGE_EN).test(acceptLanguage)
    ? 'en'
    : DEFAULT_ROOT_LOCALE
}

/**
 * O `value` de um `has` do Next casa o header inteiro (`^valor$`), então a expressão de produção,
 * que só olha o começo, ganha o resto do header (`(?:[;,].*)?`) no lugar do fim. O `^` e o `$`
 * explícitos mantêm a mesma semântica se o Next deixar de ancorar.
 */
export const DEV_ACCEPT_LANGUAGE_EN = '^\\s*en(?:-[A-Za-z0-9]+)*\\s*(?:[;,].*)?$'

/** Formato de um redirect do `next.config.ts` (o subconjunto que a raiz usa). */
export interface RootRedirect {
  readonly source: '/'
  readonly destination: '/en/' | '/pt-BR/'
  readonly permanent: false
  // Array mutável: é o tipo `RouteHas[]` que o `NextConfig` espera.
  readonly has?: { readonly type: 'header'; readonly key: string; readonly value: string }[]
}

/**
 * Redirects da raiz em `next dev` (sem export, o `next.config.ts` aceita `redirects()`): a mesma
 * escolha de produção, para a raiz nunca mostrar a página de entrada estática. Temporários (307):
 * a resposta depende do header.
 */
export function devRootRedirects(): RootRedirect[] {
  return [
    {
      source: '/',
      has: [{ type: 'header', key: 'accept-language', value: DEV_ACCEPT_LANGUAGE_EN }],
      destination: '/en/',
      permanent: false,
    },
    { source: '/', destination: `/${DEFAULT_ROOT_LOCALE}/`, permanent: false },
  ]
}
