'use client'

import { code } from '@streamdown/code'
import { type ReactNode, useMemo } from 'react'
import { harden } from 'rehype-harden'
import { type Components, defaultRehypePlugins, Streamdown, type StreamdownProps } from 'streamdown'
import {
  citationIdFromHref,
  citationLinksToAnchors,
  hardenOptions,
  isAllowedHref,
} from '@/lib/chat/markdown'
import { SITE_ORIGIN } from '@/lib/site'

interface AnswerMarkdownProps {
  /** Markdown da resposta, com as citações como links `cite:S1`. */
  readonly markdown: string
  readonly streaming: boolean
  /** Chip no lugar do link `cite:<id>`. */
  readonly renderCitation: (id: string) => ReactNode
}

function pageOrigin(): string {
  return typeof window === 'undefined' ? SITE_ORIGIN : window.location.origin
}

/**
 * Markdown das respostas com Streamdown (fecha blocos incompletos durante o stream) e realce de
 * código pelo `@streamdown/code` (Shiki com o motor de regex em JavaScript: sem WASM nem `eval`,
 * dentro da CSP). Sem mermaid nem math. Sem `rehype-raw`, HTML cru sai como texto, nunca como
 * elemento; o `rehype-harden` só deixa links para a própria origem e para as fontes oficiais e
 * remove imagens.
 *
 * Carregado sob demanda (`lazy`): fica fora do primeiro carregamento de todas as páginas.
 */
export default function AnswerMarkdown({
  markdown,
  streaming,
  renderCitation,
}: AnswerMarkdownProps) {
  const origin = pageOrigin()
  const rehypePlugins = useMemo<NonNullable<StreamdownProps['rehypePlugins']>>(() => {
    const sanitize = defaultRehypePlugins['sanitize']
    const hardened: [typeof harden, Parameters<typeof harden>[0]] = [harden, hardenOptions(origin)]
    return sanitize === undefined ? [hardened] : [sanitize, hardened]
  }, [origin])
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children }) => {
        const citationId = citationIdFromHref(href)
        if (citationId !== null) return renderCitation(citationId)
        if (isAllowedHref(href, origin)) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-4"
            >
              {children}
            </a>
          )
        }
        return <span>{children}</span>
      },
      img: () => null,
    }),
    [origin, renderCitation],
  )
  return (
    <Streamdown
      mode={streaming ? 'streaming' : 'static'}
      isAnimating={streaming}
      // Cursor discreto no fim do texto enquanto a resposta chega (some no fim do stream).
      caret="circle"
      plugins={{ code }}
      controls={false}
      rehypePlugins={rehypePlugins}
      components={components}
      className="[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:font-semibold [&_h1]:font-serif [&_h1]:text-xl [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:font-semibold [&_h2]:font-serif [&_h2]:text-lg [&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:font-semibold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_p:first-child]:mt-0 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&>*:last-child]:after:text-leaf"
    >
      {citationLinksToAnchors(markdown)}
    </Streamdown>
  )
}
