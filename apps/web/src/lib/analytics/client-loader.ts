import type { AnalyticsClient, AnalyticsClientLoader } from './adapter.ts'

/** Cliente que não envia nada. */
const NOOP_CLIENT: AnalyticsClient = {
  capture: () => undefined,
  setSurveysEnabled: () => undefined,
  disable: () => undefined,
}

/**
 * Carregador do cliente de analytics. Na F5 o SDK do PostHog ainda não entra (decisão em
 * `openspec/changes/add-i18n-en-ptbr/design.md`): o cliente é no-op. A F6
 * (`add-product-analytics`) troca o corpo por `import('./posthog-client.ts')`, que inicializa o
 * `posthog-js` com `api_host` EU, `disable_external_dependency_loading: true`,
 * `cookieless_mode: 'on_reject'`, `person_profiles: 'identified_only'` e replay desligado. O
 * `import()` mantém o SDK fora do first-load, e o adapter só chama este carregador depois do
 * consentimento e com a chave pública presente.
 */
export const loadAnalyticsClient: AnalyticsClientLoader = async () => NOOP_CLIENT
