import { describe, expect, it, vi } from 'vitest'
import type { FamilyCoverageRecord } from '#domain/vigencia/coverage-decision.ts'
import type { CoverageRepository } from '../ports/coverage-repository.ts'
import {
  COVERAGE_CACHE_TTL_MS,
  createCheckCoverage,
  createCoverageSource,
  createGetCoverage,
} from './check-coverage.ts'

const RCTE: FamilyCoverageRecord = {
  family: 'rcte',
  jurisdiction: 'GO',
  covered: [{ from: '1998-01-01', to: null }],
  verifiedAt: '2026-11-10',
  gaps: [],
}

const SNAPSHOT = { corpusVersion: 14, families: [RCTE] }

function setup(load: CoverageRepository['loadCoverage'] = () => Promise.resolve(SNAPSHOT)) {
  let now = Date.parse('2026-11-10T12:00:00-03:00')
  const loadCoverage = vi.fn<CoverageRepository['loadCoverage']>(load)
  const coverage = createCoverageSource({
    coverageRepository: { loadCoverage },
    clock: { now: () => new Date(now) },
  })
  const checkCoverage = createCheckCoverage({ coverage })
  return {
    checkCoverage,
    getCoverage: createGetCoverage({ coverage }),
    loadCoverage,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe('createGetCoverage', () => {
  it('devolve a cobertura efetiva e a corpus_version, dividindo o cache da CheckCoverage', async () => {
    const { getCoverage, checkCoverage, loadCoverage } = setup()
    await checkCoverage('2006-05-01', ['rcte'])
    await expect(getCoverage()).resolves.toEqual({
      corpusVersion: 14,
      families: [
        {
          family: 'rcte',
          jurisdiction: 'GO',
          covered: [{ from: '1998-01-01', to: '2026-11-11' }],
          verifiedAt: '2026-11-10',
        },
      ],
    })
    expect(loadCoverage).toHaveBeenCalledOnce()
  })
})

describe('createCheckCoverage', () => {
  it('decide sobre a cobertura lida do repositório', async () => {
    const { checkCoverage } = setup()
    await expect(checkCoverage('2006-05-01', ['rcte'])).resolves.toMatchObject({
      status: 'covered',
      coveredFamilies: ['rcte'],
    })
    await expect(checkCoverage('2026-12-01', ['rcte'])).resolves.toMatchObject({
      status: 'out_of_coverage',
    })
  })

  it('guarda a cobertura em memória por 10 min e relê depois do prazo', async () => {
    expect(COVERAGE_CACHE_TTL_MS).toBe(600_000)
    const { checkCoverage, loadCoverage, advance } = setup()
    await checkCoverage('2006-05-01', ['rcte'])
    advance(COVERAGE_CACHE_TTL_MS - 1)
    await checkCoverage('2006-05-01', ['rcte'])
    expect(loadCoverage).toHaveBeenCalledOnce()
    advance(1)
    await checkCoverage('2006-05-01', ['rcte'])
    expect(loadCoverage).toHaveBeenCalledTimes(2)
  })

  it('relê se o relógio voltar', async () => {
    const { checkCoverage, loadCoverage, advance } = setup()
    await checkCoverage('2006-05-01', ['rcte'])
    advance(-1)
    await checkCoverage('2006-05-01', ['rcte'])
    expect(loadCoverage).toHaveBeenCalledTimes(2)
  })

  it('chamadas simultâneas dividem a mesma leitura', async () => {
    const { checkCoverage, loadCoverage } = setup()
    await Promise.all([
      checkCoverage('2006-05-01', ['rcte']),
      checkCoverage('2010-01-01', ['rcte']),
      checkCoverage('2020-01-01', []),
    ])
    expect(loadCoverage).toHaveBeenCalledOnce()
  })

  it('leitura que falhou não fica no cache', async () => {
    const { checkCoverage, loadCoverage } = setup(
      vi
        .fn<CoverageRepository['loadCoverage']>()
        .mockRejectedValueOnce(new Error('Neon fora'))
        .mockResolvedValue(SNAPSHOT),
    )
    await expect(checkCoverage('2006-05-01', ['rcte'])).rejects.toThrow('Neon fora')
    await expect(checkCoverage('2006-05-01', ['rcte'])).resolves.toMatchObject({
      status: 'covered',
    })
    expect(loadCoverage).toHaveBeenCalledTimes(2)
  })

  it('a falha de uma leitura antiga não apaga a leitura que a substituiu', async () => {
    let rejectOld: (error: Error) => void = () => {}
    const { checkCoverage, loadCoverage, advance } = setup(
      vi
        .fn<CoverageRepository['loadCoverage']>()
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectOld = reject
            }),
        )
        .mockResolvedValue(SNAPSHOT),
    )
    const old = checkCoverage('2006-05-01', ['rcte'])
    advance(COVERAGE_CACHE_TTL_MS)
    await checkCoverage('2006-05-01', ['rcte'])
    rejectOld(new Error('conexão caiu'))
    await expect(old).rejects.toThrow('conexão caiu')
    await checkCoverage('2006-05-01', ['rcte'])
    expect(loadCoverage).toHaveBeenCalledTimes(2)
  })
})
