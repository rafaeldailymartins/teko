import { Family } from '../corpus/family.ts'
import { buildStableKey, type StableKeySegment } from '../corpus/provision-id.ts'

/**
 * Referências explícitas a dispositivos no texto da pergunta ("art. 76, § 6º", "Registro C170,
 * campo 07", "R-2010"), convertidas em `stable_key` candidatas. Alimentam o braço `exact` da busca
 * híbrida (`$5`), que só casa chave idêntica: por isso a lista traz a chave mais específica e as
 * dos níveis acima (o artigo, o registro).
 *
 * A família vem do próprio texto ("RCTE", "CTE", "EFD-Reinf"...) ou, sem menção, das famílias
 * pedidas que usam aquele tipo de referência.
 */

const ROMAN = '[IVXLC]{1,8}'

const ARTICLE = new RegExp(
  `\\bart(?:igo|\\.)?\\s*(\\d{1,4})(?:\\s*-\\s*([A-Z]))?(?:\\s*[ºo°])?` +
    `(?:\\s*,?\\s*(?:§\\s*|par[aá]grafo\\s+)(\\d{1,2}|[uú]nico)(?:\\s*[ºo°])?)?` +
    `(?:\\s*,?\\s*inc(?:iso|\\.)?\\s*(${ROMAN}))?` +
    `(?:\\s*,?\\s*al[ií]nea\\s*["“]?([a-z])\\b)?`,
  'giu',
)
/** Ordem natural do português: "§ 6º do art. 76", "parágrafo único do artigo 5". */
const PARAGRAPH_OF_ARTICLE = new RegExp(
  `(?:§\\s*|par[aá]grafo\\s+)(\\d{1,2}|[uú]nico)(?:\\s*[ºo°])?\\s+(?:do|ao|no)\\s+` +
    `art(?:igo|\\.)?\\s*(\\d{1,4})(?:\\s*-\\s*([A-Z]))?`,
  'giu',
)
const REGISTER = /\b(?:registro|reg\.)\s*([0-9A-K]\d{3})\b|\b([A-K]\d{3})\b/giu
const FIELD = /\bcampo\s*(\d{1,3})\b/iu
const REINF_EVENT = /\bR-?(\d{4})\b/gu

const ARTICLE_FAMILIES: readonly Family[] = [Family.Rcte, Family.Cte]
const REGISTER_FAMILIES: readonly Family[] = [Family.EfdIcmsIpi, Family.EfdGo]

function mentionedLawFamilies(text: string): Family[] {
  const families: Family[] = []
  if (/\bRCTE\b|regulamento do c[oó]digo tribut[aá]rio/iu.test(text)) {
    families.push(Family.Rcte)
  }
  if (
    /\bCTE\b|c[oó]digo tribut[aá]rio do estado/iu.test(text) &&
    !/regulamento do c[oó]digo/iu.test(text)
  ) {
    families.push(Family.Cte)
  }
  return families
}

function targetFamilies(
  mentioned: readonly Family[],
  candidates: readonly Family[],
  requested: readonly string[],
): Family[] {
  if (mentioned.length > 0) {
    return [...mentioned]
  }
  return candidates.filter((family) => requested.length === 0 || requested.includes(family))
}

function paragraphValue(paragraph: string): string {
  return /^\d/.test(paragraph) ? String(Number(paragraph)) : 'unico'
}

function articleValue(number: string | undefined, letter: string | undefined): string {
  return `${number ?? ''}${letter === undefined ? '' : `-${letter.toUpperCase()}`}`
}

function articleSegments(match: RegExpExecArray): StableKeySegment[][] {
  const [, number, letter, paragraph, inciso, alinea] = match
  const levels: StableKeySegment[][] = [[{ kind: 'art', value: articleValue(number, letter) }]]
  let current = levels[0] ?? []
  if (paragraph !== undefined) {
    current = [...current, { kind: 'par', value: paragraphValue(paragraph) }]
    levels.push(current)
  }
  if (inciso !== undefined) {
    current = [...current, { kind: 'inc', value: inciso.toUpperCase() }]
    levels.push(current)
  }
  if (alinea !== undefined) {
    current = [...current, { kind: 'ali', value: alinea.toLowerCase() }]
    levels.push(current)
  }
  return levels
}

function safeKey(family: Family, segments: readonly StableKeySegment[]): string | undefined {
  try {
    return buildStableKey(family, segments)
  } catch {
    return undefined
  }
}

/**
 * @param requested famílias pedidas (vazio = todas).
 * @returns chaves sem repetição, da mais específica para a mais geral de cada referência.
 */
export function extractProvisionRefs(text: string, requested: readonly string[] = []): string[] {
  const keys: string[] = []
  const push = (family: Family, segments: readonly StableKeySegment[]) => {
    const key = safeKey(family, segments)
    if (key !== undefined && !keys.includes(key)) {
      keys.push(key)
    }
  }

  const lawFamilies = targetFamilies(mentionedLawFamilies(text), ARTICLE_FAMILIES, requested)
  for (const [, paragraph = '', number, letter] of text.matchAll(PARAGRAPH_OF_ARTICLE)) {
    const article: StableKeySegment = { kind: 'art', value: articleValue(number, letter) }
    for (const family of lawFamilies) {
      push(family, [article, { kind: 'par', value: paragraphValue(paragraph) }])
      push(family, [article])
    }
  }
  for (const match of text.matchAll(ARTICLE)) {
    const levels = articleSegments(match).reverse()
    for (const family of lawFamilies) {
      for (const segments of levels) {
        push(family, segments)
      }
    }
  }

  const registerFamilies = targetFamilies([], REGISTER_FAMILIES, requested)
  const field = FIELD.exec(text)?.[1]
  for (const match of text.matchAll(REGISTER)) {
    const register = (match[1] ?? match[2] ?? '').toUpperCase()
    for (const family of registerFamilies) {
      if (field !== undefined) {
        push(family, [
          { kind: 'reg', value: register },
          { kind: 'campo', value: field.padStart(2, '0') },
        ])
      }
      push(family, [{ kind: 'reg', value: register }])
    }
  }

  if (requested.length === 0 || requested.includes(Family.EfdReinf)) {
    for (const match of text.matchAll(REINF_EVENT)) {
      push(Family.EfdReinf, [{ kind: 'evt', value: `R-${match[1] ?? ''}` }])
    }
  }
  return keys
}
