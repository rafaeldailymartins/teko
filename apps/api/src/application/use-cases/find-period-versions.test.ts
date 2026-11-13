import { describe, expect, it, vi } from 'vitest'
import type { SearchRepository } from '../ports/search-repository.ts'
import { createFindPeriodVersions } from './find-period-versions.ts'

function setup() {
  const versionsInPeriod = vi.fn<SearchRepository['versionsInPeriod']>(() =>
    Promise.resolve([{ from: '2005-12-29', to: null }]),
  )
  const find = createFindPeriodVersions({
    searchRepository: { search: () => Promise.resolve([]), versionsInPeriod },
    reviewStatuses: ['auto', 'approved'],
  })
  return { find, versionsInPeriod }
}

describe('createFindPeriodVersions', () => {
  it('consulta o mês do PA nas unidades das chaves, com as famílias e os status', async () => {
    const { find, versionsInPeriod } = setup()
    await expect(
      find({
        periodo: '2005-12',
        families: ['cte'],
        stableKeys: ['go:cte:art:47', 'go:cte:art:47:par:1', 'go:cte:art:45:inc:XIV'],
      }),
    ).resolves.toEqual([{ from: '2005-12-29', to: null }])
    expect(versionsInPeriod).toHaveBeenCalledWith({
      period: { from: '2005-12-01', to: '2006-01-01' },
      scopes: ['go:cte:art:45', 'go:cte:art:47'],
      families: ['cte'],
      reviewStatuses: ['auto', 'approved'],
    })
  })

  it('sem unidade ou sem família não consulta o banco', async () => {
    const { find, versionsInPeriod } = setup()
    await expect(find({ periodo: '2005-12', families: ['cte'], stableKeys: [] })).resolves.toEqual(
      [],
    )
    await expect(
      find({ periodo: '2005-12', families: [], stableKeys: ['go:cte:art:47'] }),
    ).resolves.toEqual([])
    expect(versionsInPeriod).not.toHaveBeenCalled()
  })
})
