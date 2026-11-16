import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/theme'
import { BareDocument } from './bare-document.tsx'
import { GatewayPage, gatewayMetadata, ROOT_LOCALE_SCRIPT } from './gateway-page.tsx'
import { generateGlobalNotFoundMetadata } from './global-not-found-page.tsx'

// `next/font` só existe no build do Next (transformação SWC); aqui basta a variável CSS.
vi.mock('next/font/google', () => import('../../../test/next-font-google.ts'))

describe('BareDocument', () => {
  const html = renderToStaticMarkup(
    <BareDocument>
      <h1>conteúdo</h1>
    </BareDocument>,
  )

  it('aplica as variáveis das fontes no <html>, como o layout de locale', () => {
    expect(html).toMatch(/<html lang="pt-BR" class="font-var-sans font-var-mono font-var-serif"/)
  })

  it('roda o bootstrap de tema como primeiro filho do <body>', () => {
    expect(html).toContain(`<body><script>${THEME_BOOTSTRAP_SCRIPT}</script>`)
  })
})

describe('GatewayPage', () => {
  const page = async () => renderToStaticMarkup(await GatewayPage())

  it('vai na hora para o idioma do navegador pelo script externo', async () => {
    expect(await page()).toContain(`<script src="${ROOT_LOCALE_SCRIPT}"></script>`)
  })

  it('sem JavaScript, redireciona para o locale padrão e oferece os dois idiomas', async () => {
    const html = await page()
    expect(html).toContain(
      '<noscript><meta http-equiv="refresh" content="0; url=/pt-BR/"/></noscript>',
    )
    const noscript = html.slice(html.lastIndexOf('<noscript>'))
    expect(noscript).toContain('href="/en/"')
    expect(noscript).toContain('href="/pt-BR/"')
  })

  it('não mostra escolha de idioma com JavaScript: só a logo, fora do <noscript>', async () => {
    const html = await page()
    const visible = html.replaceAll(/<noscript>.*?<\/noscript>/gs, '')
    expect(visible).not.toContain('href=')
    expect(visible).not.toContain('Escolha o idioma')
    expect(visible).toContain('<svg')
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
