import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { EmptyState } from '@/components/empty-state'
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/theme'
import { Badge } from './badge.tsx'
import { buttonVariants } from './button.tsx'
import { FONT_VARIABLES_CLASS_NAME } from './fonts.ts'
import { SkipLink } from './skip-link.tsx'
import { ThemeScript } from './theme-script.tsx'

// `next/font` só existe no build do Next (transformação SWC); aqui basta a variável CSS.
vi.mock('next/font/google', () => import('../../../test/next-font-google.ts'))

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
  it('junta as variáveis CSS das três fontes', () => {
    expect(FONT_VARIABLES_CLASS_NAME).toBe('font-var-sans font-var-mono font-var-serif')
  })
})

describe('ThemeScript', () => {
  it('emite o bootstrap de tema sem escapar (o hash do CSP depende do texto exato)', () => {
    expect(renderToStaticMarkup(<ThemeScript />)).toBe(`<script>${THEME_BOOTSTRAP_SCRIPT}</script>`)
  })
})

describe('buttonVariants', () => {
  it('estiliza um link como botão, com as variantes pedidas', () => {
    const classes = buttonVariants({ size: 'lg', variant: 'outline' })
    expect(classes).toContain('border-border-strong')
    expect(classes).toContain('h-10')
    expect(buttonVariants()).toContain('bg-primary text-primary-foreground')
  })
})

describe('EmptyState', () => {
  it('usa h2 por padrão e esconde o ícone dos leitores de tela', () => {
    const html = renderToStaticMarkup(
      <EmptyState icon={<svg />} title="Nada aqui">
        Ainda não há conversas.
      </EmptyState>,
    )
    expect(html).toMatch(/<h2 [^>]*>Nada aqui<\/h2>/)
    expect(html).toContain('<span aria-hidden="true"')
    expect(html).toContain('Ainda não há conversas.')
  })

  it('aceita h1 quando é o conteúdo principal', () => {
    const html = renderToStaticMarkup(
      <EmptyState icon={<svg />} title="Faça uma pergunta" headingLevel={1}>
        texto
      </EmptyState>,
    )
    expect(html).toMatch(/<h1 [^>]*>Faça uma pergunta<\/h1>/)
  })
})
