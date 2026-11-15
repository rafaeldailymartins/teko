import type { AnalyticsEventName, AnalyticsEventProperties } from '@teko/shared/analytics'
import type { ConsentRecord } from '@/lib/consent/storage'

/**
 * Adapter de analytics: o único caminho do app até o SDK de produto (PostHog, F6). Regras:
 *
 * - nada é carregado sem a escolha `analytics: true` gravada **e** sem a chave pública no build
 *   (`NEXT_PUBLIC_POSTHOG_KEY`, presente só na produção);
 * - o SDK entra por `import()` dentro do `load`, nunca no first-load, e só depois do consentimento;
 * - evento capturado sem cliente carregado é descartado (não há fila: sem consentimento, não há
 *   evento);
 * - recusar depois de aceitar desliga o cliente, que apaga o próprio storage.
 */

/** Cliente carregado sob demanda (a implementação do PostHog chega na F6). */
export interface AnalyticsClient {
  capture<N extends AnalyticsEventName>(name: N, properties: AnalyticsEventProperties<N>): void
  /** Liga ou desliga as pesquisas in-app (categoria `surveys`). */
  setSurveysEnabled(enabled: boolean): void
  /** Para a captura e apaga cookies e storage do SDK (consentimento retirado). */
  disable(): void
}

interface AnalyticsLoadOptions {
  /** Chave pública do projeto. */
  readonly key: string
  /** Pesquisas permitidas na escolha atual. */
  readonly surveys: boolean
}

/** Carrega o cliente (por `import()`), já configurado. */
export type AnalyticsClientLoader = (options: AnalyticsLoadOptions) => Promise<AnalyticsClient>

export interface AnalyticsOptions {
  /** Chave pública; ausente, o analytics fica desligado. */
  readonly key: string | undefined
  readonly load: AnalyticsClientLoader
}

export const AnalyticsState = {
  Disabled: 'disabled',
  Loaded: 'loaded',
} as const
export type AnalyticsState = (typeof AnalyticsState)[keyof typeof AnalyticsState]

export interface Analytics {
  /**
   * Aplica a escolha atual: carrega o cliente se permitido, ou o desliga se não. Falha no
   * carregamento deixa o analytics desligado (nunca derruba a página).
   */
  applyConsent(consent: ConsentRecord | null): Promise<AnalyticsState>
  capture<N extends AnalyticsEventName>(name: N, properties: AnalyticsEventProperties<N>): void
}

export function createAnalytics(options: AnalyticsOptions): Analytics {
  let client: AnalyticsClient | null = null
  let pending: Promise<void> | null = null
  // A escolha mais recente: um carregamento que termina depois de uma recusa não ativa o cliente.
  let wanted = false
  let surveys = false

  function state(): AnalyticsState {
    return client === null ? AnalyticsState.Disabled : AnalyticsState.Loaded
  }

  return {
    async applyConsent(consent) {
      // Lida a cada aplicação (não na criação), para quem a fornece por getter.
      const { key, load } = options
      wanted = key !== undefined && consent?.choices.analytics === true
      surveys = consent?.choices.surveys === true
      if (key === undefined || !wanted) {
        client?.disable()
        client = null
        return AnalyticsState.Disabled
      }
      if (client !== null) {
        client.setSurveysEnabled(surveys)
        return AnalyticsState.Loaded
      }
      pending ??= load({ key, surveys }).then(
        (loaded) => {
          pending = null
          if (wanted) {
            client = loaded
            loaded.setSurveysEnabled(surveys)
          } else {
            loaded.disable()
          }
        },
        () => {
          pending = null
        },
      )
      await pending
      return state()
    },
    capture(name, properties) {
      client?.capture(name, properties)
    },
  }
}
