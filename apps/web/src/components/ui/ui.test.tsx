import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/theme'
import { Badge } from './badge.tsx'
import { FONT_VARIABLES_CLASS_NAME } from './fonts.ts'
import { SkipLink } from './skip-link.tsx'
import { ThemeScript } from './theme-script.tsx'

// `next/font` só existe no build do Next (transformação SWC); aqui basta a variável CSS.
vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: 'font-var-sans', className: 'font-sans-class', style: {} }),
  Source_Serif_4: () => ({ variable: 'font-var-serif', className: 'font-serif-class', style: {} }),
}))

describe('SkipLink', () => {
  it('aponta para o alvo e fica oculto até receber foco', () => {
    const html = renderToStaticMarkup(
      <SkipLink targetId="conteudo">Pular para o conteúdo</SkipLink>,
    )
    expect(html).toContain('href="#conteudo"')
    expect(html).toContain('Pular para o conteúdo')
    expect(html).toMatch(/class="[^"]*\bsr-only\b[^"]*\bfocus:not-sr-only\b/)
  })
})

describe('Badge', () => {
  it('usa o tom neutro por padrão', () => {
    const html = renderToStaticMarkup(<Badge>Beta</Badge>)
    expect(html).toContain('text-muted-foreground')
    expect(html).toContain('>Beta</span>')
  })

  it('aplica o tom de acento', () => {
    expect(renderToStaticMarkup(<Badge tone="accent">Em construção</Badge>)).toContain(
      'bg-accent text-accent-foreground',
    )
  })
})

describe('FONT_VARIABLES_CLASS_NAME', () => {
  it('junta as variáveis CSS das duas fontes', () => {
    expect(FONT_VARIABLES_CLASS_NAME).toBe('font-var-sans font-var-serif')
  })
})

describe('ThemeScript', () => {
  it('emite o bootstrap de tema sem escapar (o hash do CSP depende do texto exato)', () => {
    expect(renderToStaticMarkup(<ThemeScript />)).toBe(`<script>${THEME_BOOTSTRAP_SCRIPT}</script>`)
  })
})
