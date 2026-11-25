/**
 * Carga sob demanda dos SDKs pesados dos adapters de saída (Better Auth, AI SDK, PostHog): o
 * `import()` dinâmico só acontece no primeiro uso, e o cold start da Function, que quase sempre
 * atende só o `/healthz` (Synthetic Monitoring), não paga a leitura e a compilação deles. A Vercel
 * cobra esse CPU como "Fluid Active CPU" (o incidente de 2026-11-25, mudança
 * `reduce-api-cold-start`).
 *
 * Devolve uma função que carrega uma vez e reaproveita a mesma promise (chamadas concorrentes
 * esperam a mesma carga). Uma falha não fica guardada: a próxima chamada tenta de novo.
 */
/**
 * Adapter com SDK carregado sob demanda que sabe carregá-lo antes da hora. Fora da Vercel (processo
 * de vida longa: stack de CI, Docker, `pnpm dev`) o `under-pressure` responde 503 quando o event
 * loop atrasa mais de 1 s, e importar um SDK grande no meio do tráfego passa disso; lá o app carrega
 * tudo antes de abrir a porta (`Container.warmUp`), como antes da carga sob demanda. Na Vercel não:
 * o cold start é cobrado em Active CPU.
 */
export interface Preloadable {
  preload(): Promise<void>
}

export function isPreloadable(value: unknown): value is Preloadable {
  return (
    typeof value === 'object' &&
    value !== null &&
    'preload' in value &&
    typeof value.preload === 'function'
  )
}

export function lazyModule<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = null
      throw error
    })
    return pending
  }
}
