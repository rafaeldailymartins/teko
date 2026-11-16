/**
 * Hosts do PostHog na União Europeia, a única região que o Tekó usa. Sem dependências, para o
 * pós-build (`scripts/lib/csp.ts`, `connect-src`), o cliente e o e2e lerem a mesma lista.
 */

/** Ingestão de eventos, flags e definições das pesquisas. */
export const POSTHOG_API_HOST = 'https://eu.i.posthog.com'

/**
 * Assets da UE. Com `disable_external_dependency_loading`, o SDK não baixa script nenhum daqui, mas
 * lê por `fetch` a configuração remota do projeto (`/array/<chave>/config`).
 */
const POSTHOG_ASSETS_HOST = 'https://eu-assets.i.posthog.com'

/** Origens que o navegador chama direto (`connect-src` da CSP). */
export const POSTHOG_ORIGINS = [POSTHOG_API_HOST, POSTHOG_ASSETS_HOST] as const
