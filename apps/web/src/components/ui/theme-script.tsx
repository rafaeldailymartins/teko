import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/theme'

/**
 * Aplica o tema salvo antes da primeira pintura (sem flash): fica como primeiro filho do `<body>`
 * de todo documento, então roda antes de qualquer conteúdo ser analisado. O hash entra no CSP do
 * pós-build.
 */
export function ThemeScript() {
  return (
    <script
      // biome-ignore lint/security/noDangerouslySetInnerHtml: constante do próprio código (sem entrada do usuário), coberta por hash no CSP; a exceção única da regra do Semgrep
      dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
    />
  )
}
