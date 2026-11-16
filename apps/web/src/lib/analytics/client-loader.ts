import type { AnalyticsClientLoader } from './adapter.ts'

/**
 * Carregador do cliente de analytics: o `posthog-js` (e o catálogo com o Zod) entra por `import()`,
 * num chunk à parte, fora do primeiro carregamento. O adapter só chama este carregador depois do
 * consentimento `analytics: true` e com a chave pública (`NEXT_PUBLIC_POSTHOG_KEY`) no build; sem
 * isso, nem o chunk é baixado.
 */
export const loadAnalyticsClient: AnalyticsClientLoader = async (options) => {
  const { loadPosthogClient } = await import('./posthog-client.ts')
  return loadPosthogClient(options)
}
