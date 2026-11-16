// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderClient } from '../../../test/render.tsx'
import { HeroStage } from './chat-demo.tsx'
import type { ChatDemoCopy, HeroTimelineCopy } from './demo-view.tsx'
import { HeroDemoMount } from './hero-demo.tsx'

const COPY: ChatDemoCopy = {
  title: 'Tekó',
  subtitle: 'Nova conversa',
  question: 'O que diz?',
  placeholder: 'Pergunte…',
  chooseDate: 'Data de referência',
  thinking: 'Consultando…',
  sources: 'Fontes',
  citation: 'RCTE, art. 76, § 6º',
  pause: 'Pausar a demonstração',
  play: 'Retomar a demonstração',
  scenes: [
    {
      chip: 'Período 05/2008',
      reference: 'Período de apuração 05/2008',
      validity: 'Vigência: 04/11/2004 a 22/11/2009',
      badge: 'Vigente em 05/2008',
      answer: 'Valia a redação de 2004.',
    },
    {
      chip: 'Período 01/2010',
      reference: 'Período de apuração 01/2010',
      validity: 'Vigência: desde 23/11/2009',
      badge: 'Vigente em 01/2010',
      answer: 'Revogado.',
    },
  ],
}

const TIMELINE: HeroTimelineCopy = {
  caption: 'Linha do tempo',
  milestones: [
    { position: 10, date: '12/09/2003', label: 'Acrescido', revoked: false },
    { position: 25, date: '04/11/2004', label: 'Nova redação', revoked: false },
    { position: 80, date: '23/11/2009', label: 'Revogado', revoked: true },
  ],
  years: [{ position: 5, year: 2003 }],
  scenes: [
    { position: 64, label: '05/2008' },
    { position: 83, label: '01/2010' },
  ],
}

/** IntersectionObserver de mentira: o teste diz quando a demonstração entra e sai da tela. */
class FakeObserver {
  static last: FakeObserver | null = null
  readonly callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    FakeObserver.last = this
  }
  observe(): void {}
  disconnect(): void {}
  show(visible: boolean): void {
    this.callback(
      [{ isIntersecting: visible } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
}

function mockMotion(reduced: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduced && query.includes('reduce'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  )
}

async function render() {
  return renderClient(
    <HeroStage copy={COPY} timeline={TIMELINE} summary="Resumo" caption="Legenda" />,
  )
}

function figure(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>('[data-testid="hero-demo"]')
  if (element === null) throw new Error('sem a demonstração')
  return element
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  FakeObserver.last = null
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('HeroStage', () => {
  it('mostra o quadro final, com as duas respostas, a animação aria-hidden e o resumo legível', async () => {
    mockMotion(false)
    const { container } = await render()
    const demo = figure(container)
    expect(demo.getAttribute('data-phase')).toBe('answered')
    expect(demo.getAttribute('data-reference')).toBe('1')
    expect(demo.querySelectorAll('[data-demo-exchange]')).toHaveLength(2)
    const window = demo.querySelector('[data-testid="hero-demo-window"]')
    expect(window?.getAttribute('aria-hidden')).toBe('true')
    expect(window?.textContent).toContain('Revogado.')
    expect(window?.querySelector('button, a, [tabindex]')).toBeNull()
    expect(container.querySelector('[data-testid="hero-demo-summary"]')?.textContent).toBe('Resumo')
    expect(demo.getAttribute('aria-labelledby')).toBe('hero-demo-caption')
    expect(
      container.querySelector('[data-testid="hero-timeline"]')?.getAttribute('aria-hidden'),
    ).toBe('true')
  })

  it('fora da tela não anda; na tela, recomeça e digita a pergunta caractere a caractere', async () => {
    mockMotion(false)
    const { container } = await render()
    const demo = figure(container)
    await advance(20_000)
    expect(demo.getAttribute('data-phase')).toBe('answered')

    act(() => FakeObserver.last?.show(true))
    await advance(2200)
    expect(demo.getAttribute('data-phase')).toBe('clearing')
    await advance(650)
    expect(demo.getAttribute('data-phase')).toBe('idle')
    expect(demo.querySelectorAll('[data-demo-exchange]')).toHaveLength(0)
    await advance(700)
    expect(demo.getAttribute('data-phase')).toBe('typing')
    expect(demo.textContent).toContain('O')
    expect(demo.textContent).not.toContain('O que diz?')
    await advance(2000)
    expect(demo.querySelector('[data-demo-chip="0"]')?.textContent).toContain('Período 05/2008')

    act(() => FakeObserver.last?.show(false))
    const phase = demo.getAttribute('data-phase')
    await advance(20_000)
    expect(demo.getAttribute('data-phase')).toBe(phase)
  })

  it('o botão pausa e retoma, e a aba oculta também pausa', async () => {
    mockMotion(false)
    const { container } = await render()
    const demo = figure(container)
    act(() => FakeObserver.last?.show(true))
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="hero-demo-toggle"]')
    expect(toggle?.getAttribute('aria-label')).toBe('Pausar a demonstração')
    await act(async () => toggle?.click())
    expect(toggle?.getAttribute('aria-label')).toBe('Retomar a demonstração')
    await advance(20_000)
    expect(demo.getAttribute('data-phase')).toBe('answered')
    await act(async () => toggle?.click())
    await advance(2200)
    expect(demo.getAttribute('data-phase')).toBe('clearing')

    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await advance(20_000)
    expect(demo.getAttribute('data-phase')).toBe('clearing')
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await advance(650)
    expect(demo.getAttribute('data-phase')).toBe('idle')
  })

  it('com movimento reduzido fica no quadro final, sem digitação nem botão de pausa', async () => {
    mockMotion(true)
    const { container } = await render()
    const demo = figure(container)
    act(() => FakeObserver.last?.show(true))
    await advance(60_000)
    expect(demo.getAttribute('data-phase')).toBe('answered')
    expect(demo.querySelectorAll('[data-demo-exchange]')).toHaveLength(2)
    expect(container.querySelector('[data-testid="hero-demo-toggle"]')).toBeNull()
  })

  it('sem IntersectionObserver, anda assim que monta', async () => {
    mockMotion(false)
    vi.stubGlobal('IntersectionObserver', undefined)
    const { container } = await render()
    await advance(2200)
    expect(figure(container).getAttribute('data-phase')).toBe('clearing')
  })
})

describe('HeroDemoMount', () => {
  const props = { copy: COPY, timeline: TIMELINE, summary: 'Resumo', caption: 'Legenda' }

  it('mostra o quadro estático e troca pelo animador carregado sob demanda', async () => {
    mockMotion(false)
    const load = vi.fn(async () => ({ default: HeroStage }))
    const { container } = await renderClient(
      <HeroDemoMount {...props} load={load}>
        <p data-testid="static-frame">quadro final</p>
      </HeroDemoMount>,
    )
    expect(load).toHaveBeenCalledOnce()
    await act(async () => {
      await Promise.resolve()
    })
    expect(container.querySelector('[data-testid="static-frame"]')).toBeNull()
    expect(figure(container).getAttribute('data-phase')).toBe('answered')
  })

  it('com movimento reduzido nem carrega o animador', async () => {
    mockMotion(true)
    const load = vi.fn(async () => ({ default: HeroStage }))
    const { container } = await renderClient(
      <HeroDemoMount {...props} load={load}>
        <p data-testid="static-frame">quadro final</p>
      </HeroDemoMount>,
    )
    expect(load).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="static-frame"]')).not.toBeNull()
  })

  it('desmontado antes de o animador chegar, não troca nada', async () => {
    mockMotion(false)
    let resolve: (value: { default: typeof HeroStage }) => void = () => undefined
    const load = vi.fn(
      () =>
        new Promise<{ default: typeof HeroStage }>((done) => {
          resolve = done
        }),
    )
    const rendered = await renderClient(
      <HeroDemoMount {...props} load={load}>
        <p>quadro final</p>
      </HeroDemoMount>,
    )
    await rendered.unmount()
    await act(async () => resolve({ default: HeroStage }))
    expect(load).toHaveBeenCalledOnce()
  })
})
