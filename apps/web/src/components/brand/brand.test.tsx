import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { BrandScreen } from './brand-screen.tsx'
import { GitHubIcon } from './github-icon.tsx'
import { TekoLogo, TekoWordmark } from './teko-logo.tsx'

describe('TekoLogo', () => {
  it('sem título é decorativa', () => {
    const html = renderToStaticMarkup(<TekoLogo />)
    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('aria-label=')
  })

  it('com título vira imagem nomeada', () => {
    const html = renderToStaticMarkup(<TekoLogo title="Logo do Tekó" variant="seal" />)
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Logo do Tekó"')
    expect(html).toContain('<title>Logo do Tekó</title>')
    expect(html).not.toContain('aria-hidden')
  })

  it('usa as cores da logo, com o âmbar da data e os gradientes em <defs>, sem <style>', () => {
    for (const variant of ['seal', 'mark'] as const) {
      const html = renderToStaticMarkup(<TekoLogo variant={variant} />)
      expect(html).toContain(`data-variant="${variant}"`)
      expect(html).toContain('#005766')
      expect(html).toContain('#e0a53b')
      expect(html).toContain('<defs>')
      expect(html).not.toContain('<style')
    }
  })

  it('o selo tem as duas folhas e o anel; o ícone compacto, uma folha só', () => {
    const count = (html: string, needle: string) => html.split(needle).length - 1
    const seal = renderToStaticMarkup(<TekoLogo variant="seal" />)
    const mark = renderToStaticMarkup(<TekoLogo variant="mark" />)
    expect(seal).toContain('r="92"')
    expect(mark).not.toContain('r="92"')
    expect(count(seal, '-leaf)"')).toBe(2)
    expect(count(mark, '-leaf)"')).toBe(1)
  })

  it('cada instância tem ids próprios nos gradientes', () => {
    const html = renderToStaticMarkup(
      <>
        <TekoLogo />
        <TekoLogo />
      </>,
    )
    const ids = [...html.matchAll(/<linearGradient id="([^"]+)"/g)].map(([, id]) => id)
    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
  })
})

describe('TekoWordmark', () => {
  it('escreve o nome em serif ao lado do ícone decorativo', () => {
    const html = renderToStaticMarkup(<TekoWordmark />)
    expect(html).toContain('font-serif')
    expect(html).toContain('>Tekó</span>')
    expect(html).toContain('aria-hidden="true"')
  })
})

describe('BrandScreen', () => {
  it('carregando: anuncia o estado, marca aria-busy e mostra a linha do tempo', () => {
    const html = renderToStaticMarkup(<BrandScreen busy label="Carregando o Tekó…" />)
    expect(html).toContain('<main id="conteudo"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('role="status"')
    expect(html).toContain('Carregando o Tekó…')
    expect(html).toContain('animate-timeline')
  })

  it('parada: sem a linha do tempo e com a ação abaixo do texto', () => {
    const html = renderToStaticMarkup(
      <BrandScreen label="Falhou">
        <button type="button">Tentar de novo</button>
      </BrandScreen>,
    )
    expect(html).toContain('aria-busy="false"')
    expect(html).not.toContain('animate-timeline')
    expect(html).toContain('Tentar de novo')
  })
})

describe('GitHubIcon', () => {
  it('é decorativo e herda a cor do texto', () => {
    const html = renderToStaticMarkup(<GitHubIcon className="size-4" />)
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('fill="currentColor"')
    expect(html).toContain('class="size-4"')
  })
})

describe('Card', () => {
  it('renderiza como section com o tom pedido', () => {
    const html = renderToStaticMarkup(
      <Card as="section" tone="raised" aria-labelledby="t">
        conteúdo
      </Card>,
    )
    expect(html).toMatch(/^<section/)
    expect(html).toContain('shadow-raised')
    expect(html).toContain('data-slot="card"')
  })

  it('padrão: div com borda fina e sombra suave', () => {
    const html = renderToStaticMarkup(<Card>x</Card>)
    expect(html).toMatch(/^<div/)
    expect(html).toContain('shadow-soft')
  })
})

describe('Badge', () => {
  it('o tom folha usa o verde do vigente', () => {
    expect(renderToStaticMarkup(<Badge tone="leaf">vigente</Badge>)).toContain(
      'text-validity-current',
    )
  })
})
