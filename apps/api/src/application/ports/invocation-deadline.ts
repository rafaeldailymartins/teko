/**
 * Prazo de invocação imposto pela plataforma.
 *
 * Na Vercel, cada invocação pode durar até o `maxDuration` configurado (300 s no Hobby, inclusive
 * stream); passou disso, 504 `FUNCTION_INVOCATION_TIMEOUT` e o `waitUntil` é cancelado. O
 * `@vercel/functions` 3.7.6 (última versão com proveniência SLSA) não tem `getDeadline()`, então o
 * prazo é calculado a partir do `maxDuration` configurado e do início da invocação.
 *
 * Fora da Vercel (Render, CI, local) não há prazo de invocação: `null`.
 */
export interface InvocationDeadline {
  /** Instante (ms desde a época) em que a invocação iniciada em `startedAtMs` é cortada. */
  deadlineFor(startedAtMs: number): number | null
}
