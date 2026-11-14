import { describe, expect, it, vi } from 'vitest'
import type { ProvisionHistory, ProvisionRepository } from '../ports/provision-repository.ts'
import {
  createProvisionUseCases,
  EXCERPT_LENGTH,
  excerptOf,
  fieldChangesOf,
  fieldsOf,
  versionAt,
} from './provisions.ts'

const NOW = new Date('2026-11-10T12:00:00Z')

const HISTORY: ProvisionHistory = {
  stableKey: 'go:rcte:art:20:inc:I',
  family: 'rcte',
  jurisdiction: 'GO',
  versions: [
    {
      label: 'RCTE, art. 20, I',
      validity: { from: '1998-01-01', to: '2024-04-01' },
      text: 'I - 17% na operação interna',
      act: null,
      structured: null,
    },
    {
      label: 'RCTE, art. 20, I',
      validity: { from: '2024-04-01', to: null },
      text: 'I - 19% na operação interna',
      act: 'Decreto nº 10.485/2024',
      structured: null,
    },
  ],
}

function setup(history: ProvisionHistory | null = HISTORY) {
  const repository: ProvisionRepository = {
    search: vi.fn<ProvisionRepository['search']>(async () => [
      {
        stableKey: 'go:rcte:art:20:inc:I',
        label: 'RCTE, art. 20, I',
        family: 'rcte',
        jurisdiction: 'GO',
        validity: { from: '2024-04-01', to: null },
        text: 'I - 19% na operação interna',
      },
    ]),
    history: vi.fn<ProvisionRepository['history']>(async () => history),
  }
  const useCases = createProvisionUseCases({
    repository,
    reviewStatuses: ['auto', 'approved'],
    clock: { now: () => NOW },
    limit: 20,
  })
  return { repository, useCases }
}

describe('SearchProvisions', () => {
  it('usa hoje em America/Sao_Paulo quando a data falta e repassa os filtros', async () => {
    const { repository, useCases } = setup()
    const result = await useCases.search({ q: 'art. 20' })
    expect(result.at).toBe('2026-11-10')
    expect(result.items[0]?.excerpt).toBe('I - 19% na operação interna')
    expect(repository.search).toHaveBeenCalledWith({
      text: 'art. 20',
      family: null,
      at: '2026-11-10',
      reviewStatuses: ['auto', 'approved'],
      limit: 20,
    })
  })

  it('respeita a data e a família pedidas', async () => {
    const { repository, useCases } = setup()
    await useCases.search({ q: 'C170', family: 'efd-icms-ipi', at: '2024-03-01' })
    expect(repository.search).toHaveBeenCalledWith(
      expect.objectContaining({ family: 'efd-icms-ipi', at: '2024-03-01' }),
    )
  })
})

describe('GetProvisionTimeline', () => {
  it('devolve as redações em ordem', async () => {
    const { useCases } = setup()
    const timeline = await useCases.timeline('go:rcte:art:20:inc:I')
    expect(timeline?.versions.map((version) => version.validity.from)).toEqual([
      '1998-01-01',
      '2024-04-01',
    ])
    expect(timeline?.versions[1]?.act).toBe('Decreto nº 10.485/2024')
  })

  it('chave inexistente devolve null', async () => {
    const { useCases } = setup(null)
    expect(await useCases.timeline('go:rcte:art:999')).toBeNull()
    expect(await useCases.diff('go:rcte:art:999', '2020-01-01', '2025-01-01')).toBeNull()
  })
})

describe('GetProvisionDiff', () => {
  it('compara as redações vigentes nas duas datas', async () => {
    const { useCases } = setup()
    const diff = await useCases.diff('go:rcte:art:20:inc:I', '2023-01-01', '2025-01-01')
    expect(diff?.before?.text).toBe('I - 17% na operação interna')
    expect(diff?.after?.text).toBe('I - 19% na operação interna')
    expect(diff?.segments).toEqual([
      { op: 'equal', text: 'I -' },
      { op: 'delete', text: ' 17%' },
      { op: 'insert', text: ' 19%' },
      { op: 'equal', text: ' na operação interna' },
    ])
    expect(diff?.fieldChanges).toEqual([])
  })

  it('data antes da primeira redação: before nulo e tudo inserido', async () => {
    const { useCases } = setup()
    const diff = await useCases.diff('go:rcte:art:20:inc:I', '1990-01-01', '2025-01-01')
    expect(diff?.before).toBeNull()
    expect(diff?.segments).toEqual([{ op: 'insert', text: 'I - 19% na operação interna' }])
  })

  it('compara os campos dos registros', async () => {
    const { useCases } = setup({
      stableKey: 'br:efd-icms-ipi:reg:C170:campo:07',
      family: 'efd-icms-ipi',
      jurisdiction: 'BR',
      versions: [
        {
          label: 'C170, campo 07',
          validity: { from: '2021-01-01', to: '2023-01-01' },
          text: 'QTD',
          act: null,
          structured: { Tipo: 'N', Tam: '-' },
        },
        {
          label: 'C170, campo 07',
          validity: { from: '2023-01-01', to: null },
          text: 'QTD',
          act: null,
          structured: { Tipo: 'N', Tam: '19', Dec: 5 },
        },
      ],
    })
    const diff = await useCases.diff(
      'br:efd-icms-ipi:reg:C170:campo:07',
      '2022-01-01',
      '2024-01-01',
    )
    expect(diff?.fieldChanges).toEqual([
      { field: 'Tam', before: '-', after: '19' },
      { field: 'Dec', before: null, after: '5' },
    ])
  })
})

describe('auxiliares', () => {
  it('excerptOf colapsa espaços e corta com reticências', () => {
    expect(excerptOf('  a\n\tb  ')).toBe('a b')
    const long = 'x'.repeat(EXCERPT_LENGTH + 10)
    expect(excerptOf(long)).toHaveLength(EXCERPT_LENGTH)
    expect(excerptOf(long).endsWith('…')).toBe(true)
  })

  it('fieldsOf ignora nulos e serializa o que não é texto', () => {
    expect(fieldsOf(null)).toBeNull()
    expect(fieldsOf({ a: 'x', b: null, c: undefined, d: ['y'] })).toEqual({ a: 'x', d: '["y"]' })
  })

  it('versionAt respeita o intervalo semiaberto', () => {
    const versions = [
      { validity: { from: null, to: '2020-01-01' } },
      { validity: { from: '2020-01-01', to: null } },
    ]
    expect(versionAt(versions, '2019-12-31')).toBe(versions[0])
    expect(versionAt(versions, '2020-01-01')).toBe(versions[1])
    expect(versionAt([], '2020-01-01')).toBeNull()
  })

  it('fieldChangesOf com um lado nulo', () => {
    expect(fieldChangesOf(null, { a: '1' })).toEqual([{ field: 'a', before: null, after: '1' }])
    expect(fieldChangesOf({ a: '1' }, null)).toEqual([{ field: 'a', before: '1', after: null }])
  })
})
