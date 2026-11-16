/**
 * Versões dos textos legais, sem dependência de runtime (a web importa no cliente sem levar o Zod).
 *
 * - `TERMS_VERSION`: versão dos Termos de uso exibida em `/terms` e padrão do `TERMS_VERSION` da
 *   API, que o onboarding exige no aceite. Mudou o texto dos Termos de forma material? Troque a
 *   versão no mesmo PR: quem aceitou a anterior passa por um novo aceite.
 * - `PRIVACY_POLICY_VERSION`: versão da política de privacidade exibida em `/privacy` e gravada
 *   com a escolha de consentimento do navegador; uma versão nova pede a escolha de novo.
 *
 * As duas seguem o formato de `termsVersionSchema` (data ISO, por convenção).
 */
export const TERMS_VERSION = '2026-11-16'

export const PRIVACY_POLICY_VERSION = '2026-11-17'
