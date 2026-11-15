/**
 * Único módulo do web que lê o ambiente (regra `teko-env-only-in-config` do Semgrep). Só entram
 * variáveis `NEXT_PUBLIC_*`, lidas por nome literal: o Next as troca pelo valor no build, e o que
 * não estiver definido no build vira `undefined` no bundle.
 */

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      /**
       * Chave pública do projeto PostHog (EU). Só a produção recebe; sem ela, o analytics não
       * carrega nem com consentimento (staging, CI e desenvolvimento ficam sem PostHog).
       */
      readonly NEXT_PUBLIC_POSTHOG_KEY?: string
    }
  }
}

/** Valor público ou `undefined` quando ausente ou só com espaços. */
function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/** Configuração pública lida no build. */
export const publicEnv = {
  posthogKey: nonEmpty(process.env.NEXT_PUBLIC_POSTHOG_KEY),
} as const
