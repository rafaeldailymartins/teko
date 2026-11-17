import { publicEnv } from '@/lib/env'
import { createErrorCapture, type ErrorClientLoader } from './error-capture.ts'

/**
 * Carregador do cliente de erros: o `posthog-js` entra por `import()`, num chunk à parte, só quando
 * o primeiro erro acontece (ADR 0037).
 */
const loadErrorClient: ErrorClientLoader = async (key) => {
  const client = await import('./error-client.ts')
  return client.loadErrorClient(key)
}

/** Instância única do app: instalada no `instrumentation-client.ts`, usada pelos `ErrorBoundary`. */
export const errorCapture = createErrorCapture({
  key: publicEnv.errorsKey,
  release: publicEnv.release,
  load: loadErrorClient,
})
