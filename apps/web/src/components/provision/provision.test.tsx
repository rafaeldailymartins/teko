// @vitest-environment happy-dom
import type { AnchorHTMLAttributes } from 'react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompareView } from '@/components/compare/compare-view'
import { provisionDiffQuery, provisionTimelineQuery } from '@/lib/api/queries'
import { createQueryClient } from '@/lib/api/query-client'
import { byText, click, type Rendered, renderClient } from '../../../test/render.tsx'
import { ProvisionDiff } from './provision-diff.tsx'
import { ProvisionTimeline } from './provision-timeline.tsx'
import { ProvisionView } from './provision-view.tsx'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const KEY = 'go:rcte:art:76:par:6'
const TODAY = '2026-11-15'
const LABEL = 'RCTE, art. 76, § 6º'

const VERSIONS = [
  {
    label: LABEL,
    validity: { from: '2003-09-12', to: '2004-11-04' },
    text: '§ 6º Excepcionalmente, para projeto de valor igual ou superior a R$ 300.000,00...',
    act: 'Decreto nº 5.825, de 05.09.03',
    fields: null,
  },
  {
    label: LABEL,
    validity: { from: '2004-11-04', to: '2009-11-23' },
    text: '§ 6º Observado o disposto no § 5º, quando o contribuinte aplicar 40.000,00...',
    act: null,
    fields: null,
  },
  {
    label: LABEL,
    validity: { from: '2009-11-23', to: null },
    text: '§ 6º Observado o disposto no § 5º, quando o contribuinte aplicar 50.000,00...',
    act: 'Decreto nº 7.000',
    fields: { Nº: '01', Campo: 'REG' },
  },
]

const TIMELINE = { stableKey: KEY, family: 'rcte', jurisdiction: 'GO', versions: VERSIONS }

function diffResponse(segments: { op: 'equal' | 'insert' | 'delete'; text: string }[]) {
  return {
    stableKey: KEY,
    before: VERSIONS[1],
    after: VERSIONS[2],
    segments,
    fieldChanges: [] as { field: string; before: string | null; after: string | null }[],
  }
}

const CHANGED = diffResponse([
  { op: 'equal', text: 'aplicar ' },
  { op: 'delete', text: '40.000,00' },
  { op: 'insert', text: '50.000,00' },
])

function seedDiff(
  client: ReturnType<typeof createQueryClient>,
  from: string,
  to: string,
  data: unknown,
) {
  client.setQueryData(
    provisionDiffQuery(KEY, { referenceDate: from }, { referenceDate: to }).queryKey,
    data as never,
  )
}

let rendered: Rendered | undefined

afterEach(async () => {
  await rendered?.unmount()
  rendered = undefined
  vi.unstubAllGlobals()
})

describe('ProvisionTimeline', () => {
  it('lista as redações com o badge de vigência e marca a escolhida', async () => {
    const onSelect = vi.fn()
    rendered = await renderClient(
      <ProvisionTimeline versions={VERSIONS} selectedIndex={1} onSelect={onSelect} today={TODAY} />,
    )
    const buttons = [...rendered.container.querySelectorAll('ol button')]
    expect(buttons).toHaveLength(3)
    expect(buttons[1]?.getAttribute('aria-current')).toBe('true')
    expect(buttons[0]?.textContent).toContain('Encerrada·12/09/2003 a 03/11/2004')
    expect(buttons[2]?.textContent).toContain('Vigente·desde 23/11/2009')
    expect(buttons[0]?.textContent).toContain('Decreto nº 5.825')
    await click(buttons[2])
    expect(onSelect).toHaveBeenCalledWith(2)
  })

  it('sem onSelect, só lista', async () => {
    rendered = await renderClient(
      <ProvisionTimeline versions={VERSIONS} selectedIndex={-1} today={TODAY} />,
    )
    expect(rendered.container.querySelectorAll('ol button')).toHaveLength(0)
    expect(rendered.container.querySelectorAll('ol li')).toHaveLength(3)
  })
})

describe('ProvisionDiff', () => {
  it('mostra as duas redações, o que entrou e o que saiu', async () => {
    const client = createQueryClient()
    seedDiff(client, '2008-05-01', '2010-01-01', {
      ...CHANGED,
      fieldChanges: [{ field: 'Tipo', before: 'N', after: null }],
    })
    rendered = await renderClient(
      <ProvisionDiff stableKey={KEY} from="2008-05-01" to="2010-01-01" today={TODAY} />,
      { client },
    )
    const text = rendered.container.textContent ?? ''
    expect(text).toContain('Em 01/05/2008')
    expect(text).toContain('Em 01/01/2010')
    expect(rendered.container.querySelector('ins')?.textContent).toBe('[incluído:50.000,00]')
    expect(rendered.container.querySelector('del')?.textContent).toBe('[removido:40.000,00]')
    expect(rendered.container.querySelector('p[lang="pt-BR"]')).not.toBeNull()
    const row = rendered.container.querySelector('tbody tr')
    expect(row?.textContent).toBe('TipoN—')
  })

  it('sem mudança e dispositivo ausente numa das datas', async () => {
    const client = createQueryClient()
    seedDiff(client, '2001-01-01', '2002-01-01', {
      ...diffResponse([{ op: 'equal', text: 'igual' }]),
      before: null,
    })
    rendered = await renderClient(
      <ProvisionDiff stableKey={KEY} from="2001-01-01" to="2002-01-01" today={TODAY} />,
      { client },
    )
    const text = rendered.container.textContent ?? ''
    expect(text).toContain('O dispositivo não existia nesta data.')
    expect(text).toContain('O texto é o mesmo nas duas datas.')
  })
})

describe('ProvisionView', () => {
  it('mostra a redação vigente na data, abre o diff sob demanda e troca pela linha do tempo', async () => {
    const client = createQueryClient()
    client.setQueryData(provisionTimelineQuery(KEY).queryKey, TIMELINE as never)
    seedDiff(client, '2003-09-12', '2004-11-04', CHANGED)
    rendered = await renderClient(<ProvisionView />, {
      client,
      searchParams: `?k=${KEY}&ref=2008-05`,
    })
    const { container } = rendered
    expect(container.querySelector('h1')?.textContent).toBe(LABEL)
    expect(container.querySelector('h1')?.getAttribute('lang')).toBe('pt-BR')
    expect(container.textContent).toContain('Redação vigente em 01/05/2008.')
    expect(container.querySelector('blockquote[lang="pt-BR"]')?.textContent).toContain('40.000,00')
    expect(container.querySelector('input[type="date"]')?.getAttribute('value')).toBe('2008-05-01')
    const compare = byText('a', 'Comparar outras datas')
    expect(compare?.getAttribute('href')).toBe(
      `/pt-BR/compare/?k=${KEY}&from=2003-09-12&to=2004-11-04`,
    )

    // O diff só aparece (e só seria pedido) depois do clique.
    expect(container.querySelector('ins')).toBeNull()
    const toggle = byText('button', 'Ver o que mudou em relação à redação anterior')
    await click(toggle)
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('ins')?.textContent).toContain('50.000,00')

    const timeline = [...container.querySelectorAll('ol button')]
    await click(timeline[2])
    expect(rendered.urls.at(-1)).toBe(`?k=${KEY}&ref=2009-11-23`)
    expect(container.querySelector('blockquote')?.textContent).toContain('50.000,00')
    expect(container.querySelector('table')?.textContent).toContain('REG')
    expect(container.querySelector('ins')).toBeNull()
  })

  it('primeira redação e data sem redação vigente', async () => {
    const client = createQueryClient()
    client.setQueryData(provisionTimelineQuery(KEY).queryKey, TIMELINE as never)
    rendered = await renderClient(<ProvisionView />, {
      client,
      searchParams: `?k=${KEY}&ref=2000-01-01`,
    })
    const text = rendered.container.textContent ?? ''
    expect(text).toContain('não tinha redação vigente em 01/01/2000')
    expect(text).toContain('Esta é a primeira redação do dispositivo.')
  })

  it('sem chave: a busca de dispositivos na data', async () => {
    rendered = await renderClient(<ProvisionView />, { searchParams: '?ref=2008-05' })
    expect(rendered.container.querySelector('h1')?.textContent).toBe('Dispositivos')
    expect(rendered.container.querySelector('search input[type="search"]')).not.toBeNull()
    expect(rendered.container.textContent).toContain('vigentes em 01/05/2008')
  })
})

describe('CompareView', () => {
  it('compara as datas da URL e valida o formulário', async () => {
    // A comparação nova (2008-05-01 → 2011-01-01) consulta a API: sem rede de verdade no teste.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(CHANGED)),
    )
    const client = createQueryClient()
    seedDiff(client, '2008-05-01', '2010-01-01', CHANGED)
    rendered = await renderClient(<CompareView />, {
      client,
      searchParams: `?k=${KEY}&from=2008-05&to=2010-01`,
    })
    const { container } = rendered
    expect(container.querySelector('ins')?.textContent).toContain('50.000,00')
    expect(byText('a', 'Abrir o dispositivo')?.getAttribute('href')).toBe(
      `/pt-BR/provision/?k=${KEY}&ref=2010-01-01`,
    )
    expect(
      byText('a', 'Exemplo: RCTE, art. 76, § 6º, em 05/2008 contra 01/2010')?.getAttribute('href'),
    ).toBe(`/pt-BR/compare/?k=${KEY}&from=2008-05&to=2010-01`)

    const form = container.querySelector('form')
    const key = container.querySelector<HTMLInputElement>('input[name="k"]')
    if (form === null || key === null) throw new Error('formulário ausente')
    key.value = 'nao e chave'
    await act(async () => form.requestSubmit())
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Chave inválida')

    key.value = KEY
    const to = container.querySelector<HTMLInputElement>('input[name="to"]')
    if (to === null) throw new Error('campo ausente')
    to.value = '2001-01-01'
    await act(async () => form.requestSubmit())
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'inicial antes da final',
    )

    to.value = '2011-01-01'
    await act(async () => form.requestSubmit())
    expect(rendered.urls.at(-1)).toBe(`?k=${KEY}&from=2008-05-01&to=2011-01-01`)
  })
})
