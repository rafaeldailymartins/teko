import { citationIdSchema } from '@teko/shared/contracts'

/**
 * Regras do markdown das respostas (Streamdown + `rehype-harden`):
 *
 * - links só para a própria origem e para as fontes oficiais; os demais viram texto;
 * - nenhuma imagem (nem `data:`);
 * - o link `cite:S1` que a API emite vira a âncora `#cite-S1` antes do parse (o sanitizador e o
 *   `urlTransform` descartariam o protocolo `cite:`), e o componente de link troca a âncora pelo
 *   `CitationChip`.
 */

const OFFICIAL_LINK_PREFIXES = [
  'https://sped.rfb.gov.br',
  'https://www.gov.br',
  'https://appasp.economia.go.gov.br',
] as const

export function allowedLinkPrefixes(origin: string): string[] {
  return [origin, ...OFFICIAL_LINK_PREFIXES]
}

export interface HardenOptions {
  readonly defaultOrigin: string
  readonly allowedLinkPrefixes: string[]
  readonly allowedImagePrefixes: string[]
  readonly allowDataImages: boolean
  readonly allowedProtocols: string[]
  readonly linkBlockPolicy: 'text-only'
  readonly imageBlockPolicy: 'remove'
}

/** Opções do `rehype-harden` para a origem da página. */
export function hardenOptions(origin: string): HardenOptions {
  return {
    defaultOrigin: origin,
    allowedLinkPrefixes: allowedLinkPrefixes(origin),
    allowedImagePrefixes: [],
    allowDataImages: false,
    allowedProtocols: [],
    linkBlockPolicy: 'text-only',
    imageBlockPolicy: 'remove',
  }
}

const CITE_LINK = /\]\(cite:(S[1-9]\d*)\)/g
const CITE_ANCHOR = /^#cite-(S[1-9]\d*)$/

export function citationLinksToAnchors(markdown: string): string {
  return markdown.replaceAll(CITE_LINK, (_match, id: string) => `](#cite-${id})`)
}

// O texto do link não aceita `[`: assim cada tentativa para no próximo colchete e a busca fica
// linear, mesmo com muitos `[` sem fechar (sem backtracking quadrático).
const CITE_MARKDOWN = /\[[^[\]]*\]\(cite:S([1-9]\d*)\)/g

/** Uma fonte na lista do "copiar resposta" (dispositivo, documento e versão). */
export interface CopiedSource {
  readonly id: string
  readonly label: string
  readonly document: { readonly title: string; readonly versionLabel: string }
}

/**
 * Texto do "copiar resposta": o markdown com cada citação como `[n]` e, no fim, a lista numerada das
 * fontes com o documento e a versão (o título da lista vem traduzido da UI).
 */
export function answerClipboardText(
  markdown: string,
  sources: readonly CopiedSource[],
  sourcesTitle: string,
): string {
  const body = markdown.replaceAll(CITE_MARKDOWN, (_match, n: string) => `[${n}]`).trim()
  if (sources.length === 0) return body
  const list = sources.map(
    (source) =>
      `[${source.id.slice(1)}] ${source.label}: ${source.document.title} (${source.document.versionLabel})`,
  )
  return [body, '', `${sourcesTitle}:`, ...list].join('\n')
}

/** `#cite-S1` → `S1`; qualquer outro href → `null`. */
export function citationIdFromHref(href: string | undefined): string | null {
  const id = href === undefined ? undefined : CITE_ANCHOR.exec(href)?.[1]
  return id !== undefined && citationIdSchema.safeParse(id).success ? id : null
}

/** Segunda barreira, depois do harden: o link só sai como `<a>` se casar um prefixo permitido. */
export function isAllowedHref(href: string | undefined, origin: string): href is string {
  if (href === undefined || href === '') return false
  let url: URL
  try {
    url = new URL(href, origin)
  } catch {
    return false
  }
  return allowedLinkPrefixes(origin).some((prefix) => {
    const allowed = new URL(prefix)
    return url.origin === allowed.origin && url.href.startsWith(allowed.href)
  })
}
