// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AnswerMarkdown from './answer-markdown.tsx'
import { BlockErrorBoundary } from './block-error-boundary.tsx'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function render(ui: React.ReactNode): Promise<void> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(ui))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('AnswerMarkdown', () => {
  it('troca cite: pelo chip e só deixa links das fontes oficiais, sem imagens nem HTML cru', async () => {
    await render(
      <AnswerMarkdown
        streaming={false}
        renderCitation={(id) => <button type="button" data-chip={id} />}
        markdown={[
          'Conforme [S1](cite:S1), veja o [guia](https://www.gov.br/sped/guia.pdf).',
          '',
          'Não siga [isto](https://evil.example/x) nem ![x](https://evil.example/x.png).',
          '',
          '<script>alert(1)</script>',
          '',
          'Texto em **negrito**.',
        ].join('\n')}
      />,
    )
    expect(container.querySelector('[data-chip="S1"]')).not.toBeNull()
    const links = [...container.querySelectorAll('a')].map((link) => link.getAttribute('href'))
    expect(links).toEqual(['https://www.gov.br/sped/guia.pdf'])
    expect(container.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(container.textContent).toContain('isto')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain('Texto em negrito.')
    // Sem `rehype-raw`, HTML cru sai como texto literal, nunca como elemento.
    expect(container.querySelector('script, iframe, style')).toBeNull()
  })
})

function Broken(): never {
  throw new Error('dado inesperado')
}

describe('BlockErrorBoundary', () => {
  it('troca só o bloco que falhou pela mensagem', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await render(
      <div>
        <BlockErrorBoundary fallback="Não foi possível mostrar este trecho.">
          <Broken />
        </BlockErrorBoundary>
        <p id="vizinho">continua</p>
      </div>,
    )
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Não foi possível mostrar este trecho.',
    )
    expect(container.querySelector('#vizinho')).not.toBeNull()
    error.mockRestore()
  })
})
