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
      /**
       * Chave pública do projeto PostHog que recebe os erros do navegador e os relatórios de CSP
       * (Error Tracking, ADR 0037). Vai no build do staging e da produção (o plano Free tem um
       * projeto só); sem ela, nem o handler de erros nem o `report-to` entram.
       */
      readonly NEXT_PUBLIC_POSTHOG_ERRORS_KEY?: string
      /** Release do build (`teko@X.Y.Z` na produção, `teko@<sha7>` no staging), o mesmo da API. */
      readonly NEXT_PUBLIC_TEKO_RELEASE?: string
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
  errorsKey: nonEmpty(process.env.NEXT_PUBLIC_POSTHOG_ERRORS_KEY),
  release: nonEmpty(process.env.NEXT_PUBLIC_TEKO_RELEASE),
} as const
