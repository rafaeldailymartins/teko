import { parseAnalyticsProperties } from '@teko/shared/analytics'
import posthog from 'posthog-js/dist/module.no-external'
// Pesquisas no bundle: com `disable_external_dependency_loading`, o SDK não as baixaria.
import 'posthog-js/dist/surveys'
import type { AnalyticsClient, AnalyticsLoadOptions } from './adapter.ts'
import { clearPosthogStorage, createBeforeSend, posthogConfig } from './posthog-config.ts'

/**
 * Cliente do PostHog (F6). Só entra por `import()` no `client-loader.ts`, chamado pelo adapter
 * depois do consentimento `analytics: true` e com a chave pública no build; nada aqui roda no
 * primeiro carregamento.
 *
 * - O `init` acontece uma vez por página; um novo aceite depois de uma recusa reaproveita a
 *   instância e só refaz o opt-in.
 * - Toda captura passa pelo schema estrito do catálogo antes do `posthog.capture`; propriedade
 *   desconhecida ou fora do formato descarta o evento.
 * - Retirar o consentimento faz o opt-out (o `cookieless_mode: 'on_reject'` troca a identidade e
 *   para de gravar), corta tudo no `before_send` e apaga o que o PostHog deixou no navegador.
 *
 * Para quem precisar da mesma instância (captura de exceções, `trace_id` nos eventos): a
 * configuração e os filtros ficam em `posthog-config.ts` (`SDK_EVENTS` para liberar `$exception`,
 * `posthogConfig` para `capture_exceptions`), e o `posthog` daqui é o singleton do
 * `posthog-js/dist/module.no-external`.
 */

let initialized = false
// Consentimento vigente nesta página: lido pelo `before_send` a cada envio.
let active = false

function setSurveys(enabled: boolean): void {
  posthog.set_config({ disable_surveys: !enabled })
}

const client: AnalyticsClient = {
  capture(name, properties) {
    if (!active) {
      return
    }
    try {
      posthog.capture(name, parseAnalyticsProperties(name, properties))
    } catch {
      // Fora do catálogo (texto livre, propriedade nova): não sai.
    }
  },
  setSurveysEnabled: setSurveys,
  disable() {
    active = false
    setSurveys(false)
    posthog.opt_out_capturing()
    clearPosthogStorage(window)
  },
}

/** Inicializa (uma vez) e liga a captura com a escolha atual. */
export function loadPosthogClient({ key, surveys }: AnalyticsLoadOptions): AnalyticsClient {
  if (!initialized) {
    posthog.init(key, posthogConfig({ surveys, beforeSend: createBeforeSend(() => active) }))
    initialized = true
  }
  active = true
  // Sem o evento `$opt_in`: o aceite já vai como `consent_updated`, do catálogo.
  posthog.opt_in_capturing({ captureEventName: false })
  setSurveys(surveys)
  return client
}
