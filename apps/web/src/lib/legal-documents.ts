import type { Messages } from './i18n/messages.ts'

/**
 * Seções das páginas de texto longo (política de privacidade, termos de uso e "Sobre"), na ordem
 * em que aparecem e no sumário. Cada id é a âncora da seção (`/pt-BR/privacy/#retention`) e a chave
 * em `legal.<documento>.sections` ou `about.sections` dos catálogos; o teste exige que a lista e o
 * catálogo tenham as mesmas seções.
 */
export const PRIVACY_SECTIONS = [
  'summary',
  'controller',
  'data',
  'questions',
  'providers',
  'storage',
  'retention',
  'rights',
  'security',
  'age',
  'changes',
  'contact',
] as const satisfies readonly (keyof Messages['legal']['privacy']['sections'])[]

export const TERMS_SECTIONS = [
  'acceptance',
  'service',
  'advice',
  'eligibility',
  'acceptableUse',
  'quota',
  'answers',
  'license',
  'warranty',
  'privacy',
  'termination',
  'changes',
  'law',
  'contact',
] as const satisfies readonly (keyof Messages['legal']['terms']['sections'])[]

export const ABOUT_SECTIONS = [
  'what',
  'corpus',
  'how',
  'limits',
  'openSource',
  'maintainer',
] as const satisfies readonly (keyof Messages['about']['sections'])[]

/**
 * Tags de rich text que os textos longos podem usar (`<p>`, `<settings>…</settings>`). O componente
 * implementa todas (o tipo obriga), e o teste reprova uma mensagem com tag fora da lista, que o
 * next-intl só acusaria no build, como erro de formatação.
 */
export const LEGAL_RICH_TAGS = [
  'p',
  'ul',
  'li',
  'strong',
  'ptBR',
  'privacy',
  'terms',
  'settings',
  'coverage',
  'about',
  'repo',
  'issues',
  'privateReport',
  'security',
  'contributing',
  'license',
  'anpd',
] as const

export type LegalRichTag = (typeof LEGAL_RICH_TAGS)[number]

/** Id de âncora a partir da chave da seção (`acceptableUse` → `acceptable-use`). */
export function sectionAnchor(section: string): string {
  return section.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}
