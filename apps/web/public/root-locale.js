// Entrada `/` fora das rotas de produção (servidor estático qualquer): vai na hora para o idioma do
// navegador, com a mesma regra do `Accept-Language` (`src/lib/i18n/root-locale.ts`): inglês quando o
// primeiro idioma é inglês, português no resto. Arquivo próprio (não inline) porque a CSP só aceita
// script inline com hash e o Semgrep só abre exceção para o script de tema.
;(() => {
  const languages = navigator.languages && navigator.languages.length > 0 ? navigator.languages : []
  const first = String(languages[0] || navigator.language || '')
  const english = /^\s*en(?:-[A-Za-z0-9]+)*\s*(?:[;,]|$)/.test(first)
  location.replace(english ? '/en/' : '/pt-BR/')
})()
