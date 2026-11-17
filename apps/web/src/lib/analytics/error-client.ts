import posthog from 'posthog-js/dist/module.no-external'
import type { ErrorClient } from './error-capture.ts'
import { ERRORS_INSTANCE_NAME, errorClientConfig } from './posthog-config.ts'

/**
 * Cliente de erros do PostHog (ADR 0037). Só entra pelo `import()` de `errors.ts`, chamado pela
 * captura no primeiro erro da página; nada aqui roda no primeiro carregamento.
 *
 * É uma instância nomeada do mesmo `posthog-js/dist/module.no-external` do analytics (o chunk do SDK
 * é um só), com a configuração de `errorClientConfig`: memória só, sem identificador persistido,
 * sem perfil e só `$exception`. Ela não depende do consentimento de analytics e não mexe na
 * instância de analytics.
 */
export function loadErrorClient(key: string): ErrorClient {
  const instance = posthog.init(key, errorClientConfig(), ERRORS_INSTANCE_NAME)
  return {
    capture(error, properties) {
      instance.captureException(error, { ...properties })
    },
  }
}
