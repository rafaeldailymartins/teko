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
