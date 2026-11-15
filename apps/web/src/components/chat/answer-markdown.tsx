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
      plugins={{ code }}
      controls={false}
      rehypePlugins={rehypePlugins}
      components={components}
      className="text-[15px] leading-relaxed [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
    >
      {citationLinksToAnchors(markdown)}
    </Streamdown>
  )
}
