import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { THEME_BOOTSTRAP_SCRIPT } from '@/shared/lib/theme'
import { GatewayPage, gatewayMetadata, generateGlobalNotFoundMetadata } from '../index.ts'
import { BareDocument } from './bare-document.tsx'

// `next/font` só existe no build do Next (transformação SWC); aqui basta a variável CSS.
vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: 'font-var-sans', className: 'font-sans-class', style: {} }),
  Source_Serif_4: () => ({ variable: 'font-var-serif', className: 'font-serif-class', style: {} }),
}))

describe('BareDocument', () => {
  const html = renderToStaticMarkup(
    <BareDocument>
      <h1>conteúdo</h1>
    </BareDocument>,
  )

  it('aplica as variáveis das fontes no <html>, como o layout de locale', () => {
    expect(html).toMatch(/<html lang="pt-BR" class="font-var-sans font-var-serif"/)
  })

  it('roda o bootstrap de tema como primeiro filho do <body>', () => {
    expect(html).toContain(`<body><script>${THEME_BOOTSTRAP_SCRIPT}</script>`)
  })
})

describe('GatewayPage', () => {
  it('redireciona para o locale padrão sem JavaScript', async () => {
    const html = renderToStaticMarkup(await GatewayPage())
    expect(html).toContain('<meta http-equiv="refresh" content="0; url=/pt-BR/"/>')
    expect(html).toContain('href="/en/"')
  })

  it('não emite hreflang (página noindex: alternates relativos seriam inválidos)', () => {
    expect(gatewayMetadata.robots).toEqual({ index: false, follow: true })
    expect(gatewayMetadata.alternates).toBeUndefined()
  })
})

describe('generateGlobalNotFoundMetadata', () => {
  it('dá título nos dois idiomas ao 404 global (WCAG 2.4.2)', async () => {
    const metadata = await generateGlobalNotFoundMetadata()
    expect(metadata.title).toBe('Página não encontrada / Page not found · Tekó')
  })
})
