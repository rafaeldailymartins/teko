/**
 * `@teko/shared`: contratos HTTP, erros RFC 9457, vigência, redação de PII, catálogo de analytics
 * e locales, compartilhados por `@teko/api` e `@teko/web`. Prefira os subpaths
 * (`@teko/shared/vigencia`, `@teko/shared/contracts`, ...) para importar só o necessário.
 */
export * from './analytics/index.ts'
export * from './contracts/index.ts'
export * from './errors/index.ts'
export * from './i18n/index.ts'
export * from './pii/index.ts'
export * from './vigencia/index.ts'
